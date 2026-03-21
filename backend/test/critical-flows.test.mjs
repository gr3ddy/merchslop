import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { after, before, beforeEach, describe, test } from 'node:test';
import path from 'node:path';

import { PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';

const backendRoot = fileURLToPath(new URL('..', import.meta.url));
const prismaCliPath = path.join(
  backendRoot,
  'node_modules',
  'prisma',
  'build',
  'index.js',
);
const prisma = new PrismaClient();

let appProcess;
let appLogs = '';
let baseUrl = '';

describe('critical backend flows', { concurrency: false }, () => {
  before(async () => {
    assert.ok(
      process.env.DATABASE_URL,
      'DATABASE_URL is required to run critical automated tests.',
    );

    await runCommand(process.execPath, [prismaCliPath, 'db', 'push', '--skip-generate']);

    const port = await findFreePort();
    baseUrl = `http://127.0.0.1:${port}`;
    appProcess = startAppProcess(port);
    await waitForHealthcheck();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  after(async () => {
    await stopAppProcess();
    await prisma.$disconnect();
  });

  test('employee onboarding supports invite completion and password reset', async () => {
    const { admin, accessToken: adminToken } = await bootstrapAdminAndLogin();
    const employee = await createEmployee({
      token: adminToken,
      payload: {
        employeeNumber: 'E2E-001',
        fullName: 'Employee Onboarding',
        email: 'employee.onboarding@example.com',
        department: 'QA',
      },
    });

    assert.ok(employee.user, 'Employee should have a linked local account.');
    assert.equal(employee.user.status, 'INVITED');

    const inviteResponse = await api('POST', '/api/auth/invite', {
      token: adminToken,
      json: {
        employeeId: employee.id,
      },
    });

    assertStatus(inviteResponse, [200, 201]);
    assert.equal(inviteResponse.data.delivery, 'manual');
    assert.ok(inviteResponse.data.token, 'Manual invite should return a plain token.');

    const inviteCompletion = await api('POST', '/api/auth/password/complete', {
      json: {
        token: inviteResponse.data.token,
        password: 'Welcome123!',
      },
    });

    assertStatus(inviteCompletion, [200, 201]);
    assert.equal(inviteCompletion.data.user.status, 'ACTIVE');
    assert.equal(inviteCompletion.data.user.employeeId, employee.id);

    const sessionResponse = await api('GET', '/api/auth/session', {
      token: inviteCompletion.data.accessToken,
    });

    assertStatus(sessionResponse, 200);
    assert.equal(sessionResponse.data.authenticated, true);
    assert.equal(sessionResponse.data.user.role, 'EMPLOYEE');
    assert.equal(sessionResponse.data.user.employeeId, employee.id);

    const resetResponse = await api('POST', '/api/auth/password/reset-token', {
      token: adminToken,
      json: {
        employeeId: employee.id,
      },
    });

    assertStatus(resetResponse, [200, 201]);
    assert.equal(resetResponse.data.delivery, 'manual');
    assert.ok(resetResponse.data.token, 'Manual reset should return a plain token.');

    const resetCompletion = await api('POST', '/api/auth/password/complete', {
      json: {
        token: resetResponse.data.token,
        password: 'Renewed123!',
      },
    });

    assertStatus(resetCompletion, [200, 201]);
    assert.equal(resetCompletion.data.user.status, 'ACTIVE');

    const employeeLogin = await api('POST', '/api/auth/login', {
      json: {
        email: employee.email,
        password: 'Renewed123!',
      },
    });

    assertStatus(employeeLogin, [200, 201]);
    assert.equal(employeeLogin.data.user.role, 'EMPLOYEE');
    assert.equal(employeeLogin.data.user.id, inviteCompletion.data.user.id);
  });

  test('order reserve -> confirm -> cancel keeps balance and stock consistent', async () => {
    const { admin } = await bootstrapAdminAndLogin();
    const adminHeaders = buildAdminHeaders(admin.id);
    const employee = await createEmployee({
      headers: adminHeaders,
      payload: {
        employeeNumber: 'E2E-002',
        fullName: 'Order Employee',
        email: 'employee.orders@example.com',
        department: 'Logistics',
      },
    });

    assert.ok(employee.user, 'Employee should have a linked local account.');

    await prisma.accrualReason.create({
      data: {
        code: 'ORDER_TEST',
        title: 'Order Test Reason',
        appliesToAccrual: true,
      },
    });

    const product = await prisma.product.create({
      data: {
        sku: 'ORDER-SKU-001',
        title: 'Order Test Hoodie',
        pricePoints: 40,
        stockQty: 5,
      },
    });

    const accrualResponse = await api('POST', '/api/transactions/accruals', {
      headers: adminHeaders,
      json: {
        employeeId: employee.id,
        amount: 100,
        reasonCode: 'ORDER_TEST',
        comment: 'Seed balance for order flow.',
      },
    });

    assertStatus(accrualResponse, [200, 201]);

    const orderResponse = await api('POST', '/api/orders', {
      headers: buildEmployeeHeaders(employee.user.id, employee.id),
      json: {
        items: [
          {
            productId: product.id,
            quantity: 2,
          },
        ],
        comment: 'Please reserve points for this order.',
      },
    });

    assertStatus(orderResponse, [200, 201]);
    assert.equal(orderResponse.data.order.status, 'CREATED');

    const reservedSnapshot = await prisma.balanceSnapshot.findUniqueOrThrow({
      where: {
        employeeId: employee.id,
      },
    });
    const reservedProduct = await prisma.product.findUniqueOrThrow({
      where: {
        id: product.id,
      },
    });
    const reservedTransactions = await prisma.transaction.findMany({
      where: {
        employeeId: employee.id,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    assert.equal(reservedSnapshot.availableAmount.toString(), '20');
    assert.equal(reservedSnapshot.reservedAmount.toString(), '80');
    assert.equal(reservedProduct.stockQty, 5);
    assert.deepEqual(
      reservedTransactions.map((transaction) => transaction.type),
      ['ACCRUAL', 'RESERVE'],
    );

    const orderId = orderResponse.data.order.id;
    const confirmResponse = await api('PATCH', `/api/orders/${orderId}/status`, {
      headers: adminHeaders,
      json: {
        status: 'CONFIRMED',
        comment: 'Stock confirmed.',
      },
    });

    assertStatus(confirmResponse, 200);

    const confirmedSnapshot = await prisma.balanceSnapshot.findUniqueOrThrow({
      where: {
        employeeId: employee.id,
      },
    });
    const confirmedProduct = await prisma.product.findUniqueOrThrow({
      where: {
        id: product.id,
      },
    });
    const confirmedTransactions = await prisma.transaction.findMany({
      where: {
        employeeId: employee.id,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    assert.equal(confirmedSnapshot.availableAmount.toString(), '20');
    assert.equal(confirmedSnapshot.reservedAmount.toString(), '0');
    assert.equal(confirmedProduct.stockQty, 3);
    assert.deepEqual(
      confirmedTransactions.map((transaction) => transaction.type),
      ['ACCRUAL', 'RESERVE', 'WRITE_OFF'],
    );

    const cancelResponse = await api('PATCH', `/api/orders/${orderId}/status`, {
      headers: adminHeaders,
      json: {
        status: 'CANCELED',
        comment: 'Order canceled after confirmation.',
      },
    });

    assertStatus(cancelResponse, 200);

    const canceledOrder = await prisma.order.findUniqueOrThrow({
      where: {
        id: orderId,
      },
    });
    const refundedSnapshot = await prisma.balanceSnapshot.findUniqueOrThrow({
      where: {
        employeeId: employee.id,
      },
    });
    const refundedProduct = await prisma.product.findUniqueOrThrow({
      where: {
        id: product.id,
      },
    });
    const refundedTransactions = await prisma.transaction.findMany({
      where: {
        employeeId: employee.id,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    assert.equal(canceledOrder.status, 'CANCELED');
    assert.equal(refundedSnapshot.availableAmount.toString(), '100');
    assert.equal(refundedSnapshot.reservedAmount.toString(), '0');
    assert.equal(refundedProduct.stockQty, 5);
    assert.deepEqual(
      refundedTransactions.map((transaction) => transaction.type),
      ['ACCRUAL', 'RESERVE', 'WRITE_OFF', 'RELEASE'],
    );
  });

  test('persisted cart stores items and metadata until checkout clears it into an order', async () => {
    const { admin } = await bootstrapAdminAndLogin();
    const adminHeaders = buildAdminHeaders(admin.id);
    const employee = await createEmployee({
      headers: adminHeaders,
      payload: {
        employeeNumber: 'E2E-002-CART',
        fullName: 'Cart Employee',
        email: 'employee.cart@example.com',
        department: 'Marketplace',
      },
    });

    assert.ok(employee.user, 'Employee should have a linked local account.');

    await prisma.accrualReason.create({
      data: {
        code: 'CART_TEST',
        title: 'Cart Test Reason',
        appliesToAccrual: true,
      },
    });
    await prisma.companySettings.create({
      data: {
        id: 'default',
        companyName: 'Cart Test Company',
      },
    });

    const pickupPoint = await prisma.pickupPoint.create({
      data: {
        name: 'Main pickup point',
      },
    });
    const [productA, productB] = await Promise.all([
      prisma.product.create({
        data: {
          sku: 'CART-SKU-001',
          title: 'Cart Hoodie',
          pricePoints: 30,
          stockQty: 5,
        },
      }),
      prisma.product.create({
        data: {
          sku: 'CART-SKU-002',
          title: 'Cart Mug',
          pricePoints: 20,
          stockQty: 5,
        },
      }),
    ]);

    const accrualResponse = await api('POST', '/api/transactions/accruals', {
      headers: adminHeaders,
      json: {
        employeeId: employee.id,
        amount: 150,
        reasonCode: 'CART_TEST',
        comment: 'Seed balance for persisted cart flow.',
      },
    });

    assertStatus(accrualResponse, [200, 201]);

    const employeeHeaders = buildEmployeeHeaders(employee.user.id, employee.id);
    const initialCartResponse = await api('GET', '/api/cart', {
      headers: employeeHeaders,
    });

    assertStatus(initialCartResponse, 200);
    assert.equal(initialCartResponse.data.itemCount, 0);
    assert.equal(initialCartResponse.data.items.length, 0);

    const updateCartResponse = await api('PATCH', '/api/cart', {
      headers: employeeHeaders,
      json: {
        pickupPointId: pickupPoint.id,
        comment: 'Use persisted cart checkout.',
      },
    });

    assertStatus(updateCartResponse, 200);
    assert.equal(updateCartResponse.data.pickupPointId, pickupPoint.id);
    assert.equal(updateCartResponse.data.comment, 'Use persisted cart checkout.');

    const cartItemAResponse = await api(
      'PUT',
      `/api/cart/items/${productA.id}`,
      {
        headers: employeeHeaders,
        json: {
          quantity: 2,
        },
      },
    );
    const cartItemBResponse = await api(
      'PUT',
      `/api/cart/items/${productB.id}`,
      {
        headers: employeeHeaders,
        json: {
          quantity: 1,
        },
      },
    );

    assertStatus(cartItemAResponse, 200);
    assertStatus(cartItemBResponse, 200);
    assert.equal(cartItemBResponse.data.itemCount, 3);
    assert.equal(cartItemBResponse.data.totalAmount, '80');

    const removeItemResponse = await api(
      'DELETE',
      `/api/cart/items/${productB.id}`,
      {
        headers: employeeHeaders,
      },
    );

    assertStatus(removeItemResponse, 200);
    assert.equal(removeItemResponse.data.itemCount, 2);
    assert.equal(removeItemResponse.data.totalAmount, '60');
    assert.equal(removeItemResponse.data.items.length, 1);

    const checkoutResponse = await api('POST', '/api/cart/checkout', {
      headers: employeeHeaders,
    });

    assertStatus(checkoutResponse, [200, 201]);
    assert.equal(checkoutResponse.data.order.status, 'CREATED');
    assert.equal(checkoutResponse.data.order.pickupPointId, pickupPoint.id);
    assert.equal(checkoutResponse.data.order.comment, 'Use persisted cart checkout.');
    assert.equal(checkoutResponse.data.order.items.length, 1);
    assert.equal(checkoutResponse.data.order.items[0].productId, productA.id);
    assert.equal(checkoutResponse.data.balance.availableAmount, '90');
    assert.equal(checkoutResponse.data.balance.reservedAmount, '60');

    const cartAfterCheckoutResponse = await api('GET', '/api/cart', {
      headers: employeeHeaders,
    });

    assertStatus(cartAfterCheckoutResponse, 200);
    assert.equal(cartAfterCheckoutResponse.data.id, initialCartResponse.data.id);
    assert.equal(cartAfterCheckoutResponse.data.itemCount, 0);
    assert.equal(cartAfterCheckoutResponse.data.totalAmount, '0');
    assert.equal(cartAfterCheckoutResponse.data.items.length, 0);
    assert.equal(cartAfterCheckoutResponse.data.pickupPointId, null);
    assert.equal(cartAfterCheckoutResponse.data.comment, null);
  });

  test('expiration sweeps warn once and expire only available points', async () => {
    const { admin } = await bootstrapAdminAndLogin();
    const adminHeaders = buildAdminHeaders(admin.id);
    const employee = await createEmployee({
      headers: adminHeaders,
      payload: {
        employeeNumber: 'E2E-003',
        fullName: 'Expiration Employee',
        email: 'employee.expiration@example.com',
        department: 'Finance',
      },
    });

    assert.ok(employee.user, 'Employee should have a linked local account.');

    await prisma.accrualReason.create({
      data: {
        code: 'EXP_TEST',
        title: 'Expiration Test Reason',
        appliesToAccrual: true,
      },
    });

    const accrualResponse = await api('POST', '/api/transactions/accruals', {
      headers: adminHeaders,
      json: {
        employeeId: employee.id,
        amount: 75,
        reasonCode: 'EXP_TEST',
        comment: 'Seed balance for expiration flow.',
      },
    });

    assertStatus(accrualResponse, [200, 201]);

    const accrualTransaction = await prisma.transaction.findFirstOrThrow({
      where: {
        employeeId: employee.id,
        type: 'ACCRUAL',
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    await prisma.transaction.update({
      where: {
        id: accrualTransaction.id,
      },
      data: {
        expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
      },
    });

    const firstWarningRun = await api('POST', '/api/expiration/warnings/run', {
      headers: adminHeaders,
    });
    const secondWarningRun = await api('POST', '/api/expiration/warnings/run', {
      headers: adminHeaders,
    });

    assertStatus(firstWarningRun, [200, 201]);
    assertStatus(secondWarningRun, [200, 201]);
    assert.equal(firstWarningRun.data.notificationsCreated, 1);
    assert.equal(firstWarningRun.data.lotsWarned, 1);
    assert.equal(secondWarningRun.data.notificationsCreated, 0);

    const warningNotifications = await prisma.notification.count({
      where: {
        userId: employee.user.id,
        type: 'POINTS_EXPIRING',
      },
    });

    assert.equal(warningNotifications, 1);

    await prisma.transaction.update({
      where: {
        id: accrualTransaction.id,
      },
      data: {
        expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      },
    });

    const expirationRun = await api('POST', '/api/expiration/run', {
      headers: adminHeaders,
    });

    assertStatus(expirationRun, [200, 201]);
    assert.equal(expirationRun.data.transactionsCreated, 1);
    assert.equal(expirationRun.data.expiredLots, 1);

    const expiredSnapshot = await prisma.balanceSnapshot.findUniqueOrThrow({
      where: {
        employeeId: employee.id,
      },
    });
    const expirationTransaction = await prisma.transaction.findFirstOrThrow({
      where: {
        employeeId: employee.id,
        type: 'EXPIRATION',
      },
    });
    const expiredNotifications = await prisma.notification.count({
      where: {
        userId: employee.user.id,
        type: 'POINTS_EXPIRED',
      },
    });

    assert.equal(expiredSnapshot.availableAmount.toString(), '0');
    assert.equal(expiredSnapshot.reservedAmount.toString(), '0');
    assert.equal(expirationTransaction.amount.toString(), '75');
    assert.equal(expiredNotifications, 1);
  });

  test('notifications summary and read actions update unread counters', async () => {
    const { admin } = await bootstrapAdminAndLogin();
    const adminHeaders = buildAdminHeaders(admin.id);
    const employee = await createEmployee({
      headers: adminHeaders,
      payload: {
        employeeNumber: 'E2E-004',
        fullName: 'Notification Employee',
        email: 'employee.notifications@example.com',
        department: 'Support',
      },
    });

    assert.ok(employee.user, 'Employee should have a linked local account.');

    await prisma.notification.createMany({
      data: [
        {
          userId: employee.user.id,
          type: 'SYSTEM',
          title: 'Notification one',
          body: 'Unread notification one.',
          sentAt: new Date(),
        },
        {
          userId: employee.user.id,
          type: 'SYSTEM',
          title: 'Notification two',
          body: 'Unread notification two.',
          sentAt: new Date(),
        },
      ],
    });

    const employeeHeaders = buildEmployeeHeaders(employee.user.id, employee.id);
    const initialSummary = await api('GET', '/api/notifications/me/summary', {
      headers: employeeHeaders,
    });
    const listResponse = await api('GET', '/api/notifications/me', {
      headers: employeeHeaders,
    });

    assertStatus(initialSummary, 200);
    assertStatus(listResponse, 200);
    assert.equal(initialSummary.data.totalCount, 2);
    assert.equal(initialSummary.data.unreadCount, 2);
    assert.equal(listResponse.data.length, 2);

    const firstNotificationId = listResponse.data[0].id;
    const markOneResponse = await api(
      'PATCH',
      `/api/notifications/me/${firstNotificationId}/read`,
      {
        headers: employeeHeaders,
      },
    );

    assertStatus(markOneResponse, 200);
    assert.ok(markOneResponse.data.readAt);

    const summaryAfterSingleRead = await api(
      'GET',
      '/api/notifications/me/summary',
      {
        headers: employeeHeaders,
      },
    );

    assertStatus(summaryAfterSingleRead, 200);
    assert.equal(summaryAfterSingleRead.data.unreadCount, 1);

    const markAllResponse = await api('PATCH', '/api/notifications/me/read-all', {
      headers: employeeHeaders,
    });

    assertStatus(markAllResponse, 200);
    assert.equal(markAllResponse.data.updatedCount, 1);

    const summaryAfterReadAll = await api('GET', '/api/notifications/me/summary', {
      headers: employeeHeaders,
    });

    assertStatus(summaryAfterReadAll, 200);
    assert.equal(summaryAfterReadAll.data.totalCount, 2);
    assert.equal(summaryAfterReadAll.data.unreadCount, 0);
  });

  test('catalog admin flow exposes created categories and products to the employee catalog', async () => {
    const { admin } = await bootstrapAdminAndLogin();
    const adminHeaders = buildAdminHeaders(admin.id);

    const categoryResponse = await api('POST', '/api/catalog/categories', {
      headers: adminHeaders,
      json: {
        name: 'Apparel',
        slug: 'apparel',
      },
    });

    assertStatus(categoryResponse, [200, 201]);

    const productResponse = await api('POST', '/api/catalog/products', {
      headers: adminHeaders,
      json: {
        sku: 'CAT-SKU-001',
        title: 'Catalog Hoodie',
        pricePoints: 120,
        stockQty: 7,
        categoryId: categoryResponse.data.id,
      },
    });

    assertStatus(productResponse, [200, 201]);

    const categoriesResponse = await api('GET', '/api/catalog/categories');
    const productsResponse = await api('GET', '/api/catalog/products');
    const productCardResponse = await api(
      'GET',
      `/api/catalog/products/${productResponse.data.id}`,
    );

    assertStatus(categoriesResponse, 200);
    assertStatus(productsResponse, 200);
    assertStatus(productCardResponse, 200);
    assert.equal(categoriesResponse.data.length, 1);
    assert.equal(categoriesResponse.data[0].id, categoryResponse.data.id);
    assert.equal(productsResponse.data.length, 1);
    assert.equal(productsResponse.data[0].id, productResponse.data.id);
    assert.equal(productCardResponse.data.id, productResponse.data.id);
    assert.equal(productCardResponse.data.title, 'Catalog Hoodie');
  });

  test('upload validation rejects unsupported employee import and catalog image files', async () => {
    const { admin } = await bootstrapAdminAndLogin();
    const adminHeaders = buildAdminHeaders(admin.id);

    const invalidImportFormData = new FormData();
    invalidImportFormData.append(
      'file',
      new Blob(['not-an-excel-workbook'], {
        type: 'text/plain',
      }),
      'employees.txt',
    );

    const invalidImportResponse = await api('POST', '/api/employees/import', {
      headers: adminHeaders,
      formData: invalidImportFormData,
    });

    assertStatus(invalidImportResponse, 400);
    assert.match(
      getErrorMessage(invalidImportResponse.data),
      /Unsupported employee import format/i,
    );

    const product = await prisma.product.create({
      data: {
        sku: 'UPLOAD-SKU-001',
        title: 'Upload Test Product',
        pricePoints: 15,
        stockQty: 2,
      },
    });

    const invalidImageFormData = new FormData();
    invalidImageFormData.append(
      'file',
      new Blob(['not-an-image'], {
        type: 'text/plain',
      }),
      'product.txt',
    );

    const invalidImageResponse = await api(
      'POST',
      `/api/catalog/products/${product.id}/images`,
      {
        headers: adminHeaders,
        formData: invalidImageFormData,
      },
    );

    assertStatus(invalidImageResponse, 400);
    assert.match(
      getErrorMessage(invalidImageResponse.data),
      /Unsupported catalog image format/i,
    );
  });

  test('employee import supports partial success and provisions local accounts', async () => {
    const { admin } = await bootstrapAdminAndLogin();
    const adminHeaders = buildAdminHeaders(admin.id);

    const templateResponse = await api('GET', '/api/employees/import-template', {
      headers: adminHeaders,
    });

    assertStatus(templateResponse, 200);
    assert.equal(templateResponse.data.fileType, 'xlsx');
    assert.deepEqual(templateResponse.data.requiredColumns, [
      'employeeNumber',
      'fullName',
      'email',
      'department',
    ]);

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet([
      ['employeeNumber', 'fullName', 'email', 'department'],
      ['IMP-001', 'Imported One', 'imported.one@example.com', 'HR'],
      ['IMP-001', 'Imported Duplicate Number', 'imported.two@example.com', 'HR'],
      ['IMP-002', 'Imported Duplicate Email', 'imported.one@example.com', 'HR'],
    ]);

    XLSX.utils.book_append_sheet(workbook, worksheet, 'employees');

    const formData = new FormData();
    formData.append(
      'file',
      new Blob([XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
      'employees-import.xlsx',
    );

    const importResponse = await api('POST', '/api/employees/import', {
      headers: adminHeaders,
      formData,
    });

    assertStatus(importResponse, [200, 201]);
    assert.equal(importResponse.data.status, 'PARTIAL');
    assert.equal(importResponse.data.rowsTotal, 3);
    assert.equal(importResponse.data.rowsSucceeded, 1);
    assert.equal(importResponse.data.rowsFailed, 2);
    assert.equal(importResponse.data.summary.sheetName, 'employees');
    assert.equal(importResponse.data.summary.createdEmployees.length, 1);
    assert.equal(importResponse.data.summary.errors.length, 2);

    const importedEmployee = await prisma.employee.findUniqueOrThrow({
      where: {
        employeeNumber: 'IMP-001',
      },
      include: {
        user: true,
        balanceSnapshot: true,
      },
    });

    assert.equal(importedEmployee.email, 'imported.one@example.com');
    assert.ok(importedEmployee.user, 'Imported employee should have a linked user.');
    assert.equal(importedEmployee.user.status, 'INVITED');
    assert.equal(importedEmployee.balanceSnapshot.availableAmount.toString(), '0');

    const importJobs = await prisma.importJob.findMany();
    assert.equal(importJobs.length, 1);
    assert.equal(importJobs[0].status, 'PARTIAL');
  });

  test('reports endpoints return list data and CSV exports for balances, transactions, orders and expirations', async () => {
    const { admin } = await bootstrapAdminAndLogin();
    const adminHeaders = buildAdminHeaders(admin.id);
    const dataset = await seedReportsDataset(adminHeaders);

    const balancesResponse = await api(
      'GET',
      `/api/reports/balances?employeeId=${dataset.employee.id}`,
      {
        headers: adminHeaders,
      },
    );
    const transactionsResponse = await api(
      'GET',
      `/api/reports/transactions?employeeId=${dataset.employee.id}`,
      {
        headers: adminHeaders,
      },
    );
    const ordersResponse = await api(
      'GET',
      `/api/reports/orders?employeeId=${dataset.employee.id}`,
      {
        headers: adminHeaders,
      },
    );
    const expirationsResponse = await api(
      'GET',
      `/api/reports/expirations?employeeId=${dataset.employee.id}`,
      {
        headers: adminHeaders,
      },
    );

    assertStatus(balancesResponse, 200);
    assertStatus(transactionsResponse, 200);
    assertStatus(ordersResponse, 200);
    assertStatus(expirationsResponse, 200);
    assert.equal(balancesResponse.data.length, 1);
    assert.equal(transactionsResponse.data.length, 5);
    assert.equal(ordersResponse.data.length, 1);
    assert.equal(expirationsResponse.data.length, 1);
    assert.equal(balancesResponse.data[0].employeeNumber, 'E2E-REPORT-001');
    assert.equal(ordersResponse.data[0].status, 'CONFIRMED');
    assert.equal(expirationsResponse.data[0].type, 'EXPIRATION');

    const balancesExportResponse = await api(
      'GET',
      `/api/reports/balances/export?employeeId=${dataset.employee.id}`,
      {
        headers: adminHeaders,
      },
    );
    const transactionsExportResponse = await api(
      'GET',
      `/api/reports/transactions/export?employeeId=${dataset.employee.id}`,
      {
        headers: adminHeaders,
      },
    );
    const ordersExportResponse = await api(
      'GET',
      `/api/reports/orders/export?employeeId=${dataset.employee.id}`,
      {
        headers: adminHeaders,
      },
    );
    const expirationsExportResponse = await api(
      'GET',
      `/api/reports/expirations/export?employeeId=${dataset.employee.id}`,
      {
        headers: adminHeaders,
      },
    );

    assertStatus(balancesExportResponse, 200);
    assertStatus(transactionsExportResponse, 200);
    assertStatus(ordersExportResponse, 200);
    assertStatus(expirationsExportResponse, 200);

    assert.equal(
      balancesExportResponse.headers.get('content-type'),
      'text/csv; charset=utf-8',
    );
    assert.equal(
      balancesExportResponse.headers.get('content-disposition'),
      'attachment; filename="balances-report.csv"',
    );
    assert.match(
      balancesExportResponse.data,
      /^employeeId,employeeNumber,fullName,email,department,status,availableAmount/m,
    );
    assert.match(balancesExportResponse.data, /E2E-REPORT-001/);
    assert.match(balancesExportResponse.data, /,60,0,/);
    assert.match(
      transactionsExportResponse.data,
      /^transactionId,effectiveAt,createdAt,employeeId,employeeNumber,employeeName,type,status,amount/m,
    );
    assert.match(transactionsExportResponse.data, /EXPIRATION/);
    assert.match(
      ordersExportResponse.data,
      /^orderId,createdAt,employeeId,employeeNumber,employeeName,status,pickupPoint,totalAmount/m,
    );
    assert.match(ordersExportResponse.data, /Report Hoodie x1 @ 40/);
    assert.match(
      expirationsExportResponse.data,
      /^transactionId,effectiveAt,createdAt,employeeId,employeeNumber,employeeName,amount/m,
    );
    assert.match(expirationsExportResponse.data, /60/);
  });
});

function startAppProcess(port) {
  const child = spawn(process.execPath, ['dist/main.js'], {
    cwd: backendRoot,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      SWAGGER_ENABLED: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    appLogs += chunk;
  });
  child.stderr.on('data', (chunk) => {
    appLogs += chunk;
  });

  return child;
}

async function stopAppProcess() {
  if (!appProcess || appProcess.exitCode !== null) {
    return;
  }

  appProcess.kill('SIGTERM');

  const didExit = await Promise.race([
    once(appProcess, 'exit').then(() => true),
    delay(5_000).then(() => false),
  ]);

  if (!didExit && appProcess.exitCode === null) {
    appProcess.kill('SIGKILL');
    await once(appProcess, 'exit');
  }
}

async function waitForHealthcheck() {
  const deadline = Date.now() + 20_000;

  while (Date.now() < deadline) {
    if (appProcess?.exitCode !== null) {
      throw new Error(
        `Backend exited before becoming healthy.${formatAppLogs()}`,
      );
    }

    try {
      const response = await fetch(`${baseUrl}/api/health`, {
        signal: AbortSignal.timeout(1_000),
      });

      if (response.ok) {
        return;
      }
    } catch {}

    await delay(250);
  }

  throw new Error(`Timed out waiting for backend healthcheck.${formatAppLogs()}`);
}

async function api(method, pathname, options = {}) {
  const headers = new Headers(options.headers ?? {});

  if (options.token) {
    headers.set('authorization', `Bearer ${options.token}`);
  }

  let body;

  if (options.formData !== undefined) {
    body = options.formData;
  } else if (options.json !== undefined) {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(options.json);
  }

  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body,
    signal: AbortSignal.timeout(5_000),
  });

  const text = await response.text();
  const contentType = response.headers.get('content-type') ?? '';
  const data =
    text.length === 0
      ? null
      : contentType.includes('application/json')
        ? JSON.parse(text)
        : text;

  return {
    status: response.status,
    data,
    headers: response.headers,
  };
}

async function bootstrapAdminAndLogin() {
  const email = 'admin@example.com';
  const password = 'StrongPass123!';

  const bootstrapResponse = await api('POST', '/api/auth/bootstrap-admin', {
    json: {
      email,
      password,
    },
  });

  assertStatus(bootstrapResponse, [200, 201]);

  const loginResponse = await api('POST', '/api/auth/login', {
    json: {
      email,
      password,
    },
  });

  assertStatus(loginResponse, [200, 201]);

  return {
    admin: bootstrapResponse.data.user,
    accessToken: loginResponse.data.accessToken,
  };
}

async function createEmployee({ headers, token, payload }) {
  const response = await api('POST', '/api/employees', {
    headers,
    token,
    json: payload,
  });

  assertStatus(response, [200, 201]);

  return response.data;
}

async function seedReportsDataset(adminHeaders) {
  const employee = await createEmployee({
    headers: adminHeaders,
    payload: {
      employeeNumber: 'E2E-REPORT-001',
      fullName: 'Reporting Employee',
      email: 'employee.reports@example.com',
      department: 'Analytics',
    },
  });

  assert.ok(employee.user, 'Reporting dataset employee should have a linked user.');

  await prisma.accrualReason.create({
    data: {
      code: 'REPORT_TEST',
      title: 'Report Test Reason',
      appliesToAccrual: true,
    },
  });

  const product = await prisma.product.create({
    data: {
      sku: 'REPORT-SKU-001',
      title: 'Report Hoodie',
      pricePoints: 40,
      stockQty: 10,
    },
  });

  const accrualResponse = await api('POST', '/api/transactions/accruals', {
    headers: adminHeaders,
    json: {
      employeeId: employee.id,
      amount: 100,
      reasonCode: 'REPORT_TEST',
      comment: 'Seed balance for reports.',
    },
  });

  assertStatus(accrualResponse, [200, 201]);

  const orderResponse = await api('POST', '/api/orders', {
    headers: buildEmployeeHeaders(employee.user.id, employee.id),
    json: {
      items: [
        {
          productId: product.id,
          quantity: 1,
        },
      ],
      comment: 'Seed order for report dataset.',
    },
  });

  assertStatus(orderResponse, [200, 201]);

  const confirmResponse = await api(
    'PATCH',
    `/api/orders/${orderResponse.data.order.id}/status`,
    {
      headers: adminHeaders,
      json: {
        status: 'CONFIRMED',
        comment: 'Confirm report order.',
      },
    },
  );

  assertStatus(confirmResponse, 200);

  const expiringAccrualResponse = await api('POST', '/api/transactions/accruals', {
    headers: adminHeaders,
    json: {
      employeeId: employee.id,
      amount: 60,
      reasonCode: 'REPORT_TEST',
      comment: 'Seed expiring balance for reports.',
    },
  });

  assertStatus(expiringAccrualResponse, [200, 201]);

  const accrualTransactions = await prisma.transaction.findMany({
    where: {
      employeeId: employee.id,
      type: 'ACCRUAL',
    },
    orderBy: {
      createdAt: 'asc',
    },
  });

  assert.equal(accrualTransactions.length, 2);

  await prisma.transaction.update({
    where: {
      id: accrualTransactions[1].id,
    },
    data: {
      expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    },
  });

  const expirationRun = await api('POST', '/api/expiration/run', {
    headers: adminHeaders,
  });

  assertStatus(expirationRun, [200, 201]);
  assert.equal(expirationRun.data.transactionsCreated, 1);

  return {
    employee,
    product,
    orderId: orderResponse.data.order.id,
  };
}

function buildAdminHeaders(userId) {
  return {
    'x-user-id': userId,
    'x-user-role': 'PROGRAM_ADMIN',
  };
}

function buildEmployeeHeaders(userId, employeeId) {
  return {
    'x-user-id': userId,
    'x-user-role': 'EMPLOYEE',
    'x-employee-id': employeeId,
  };
}

async function resetDatabase() {
  const tables = await prisma.$queryRawUnsafe(`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename <> '_prisma_migrations'
    ORDER BY tablename
  `);
  const tableNames = tables
    .map((row) => `public."${row.tablename}"`)
    .join(', ');

  if (!tableNames) {
    return;
  }

  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tableNames} CASCADE;`);
}

async function findFreePort() {
  const server = createServer();

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  assert.ok(address && typeof address === 'object', 'Failed to resolve a free port.');
  const { port } = address;

  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

  return port;
}

async function runCommand(command, args) {
  const child = spawn(command, args, {
    cwd: backendRoot,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  const [exitCode] = await once(child, 'exit');

  if (exitCode !== 0) {
    throw new Error(
      `Command failed: ${command} ${args.join(' ')}\n${stdout}${stderr}`,
    );
  }
}

function assertStatus(response, expected) {
  const expectedStatuses = Array.isArray(expected) ? expected : [expected];

  assert.ok(
    expectedStatuses.includes(response.status),
    `Expected status ${expectedStatuses.join(' or ')}, received ${response.status}.\nResponse body: ${JSON.stringify(response.data)}`,
  );
}

function getErrorMessage(data) {
  if (!data || typeof data !== 'object') {
    return String(data ?? '');
  }

  if (typeof data.message === 'string') {
    return data.message;
  }

  if (Array.isArray(data.message)) {
    return data.message.join(' ');
  }

  return JSON.stringify(data);
}

function formatAppLogs() {
  if (!appLogs.trim()) {
    return '';
  }

  return `\n\nApp logs:\n${appLogs.slice(-8_000)}`;
}
