import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { after, before, beforeEach, describe, test } from 'node:test';
import path from 'node:path';

import { PrismaClient } from '@prisma/client';

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

  if (options.json !== undefined) {
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

function formatAppLogs() {
  if (!appLogs.trim()) {
    return '';
  }

  return `\n\nApp logs:\n${appLogs.slice(-8_000)}`;
}
