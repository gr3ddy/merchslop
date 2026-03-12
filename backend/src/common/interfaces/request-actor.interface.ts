import { UserRole } from '../enums/domain.enum';

export interface RequestActor {
  userId: string;
  role: UserRole;
  employeeId?: string;
  authMode?: 'jwt' | 'dev-header';
}
