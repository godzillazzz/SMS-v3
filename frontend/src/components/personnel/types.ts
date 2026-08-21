export type PersonnelRecord = {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  displayName?: string;
  department?: string;
  jobTitle?: string;
  isActive: boolean;
  email?: string | null;
  phone?: string | null;
  hiredAt?: string | null;
  skill?: string | null;
  updatedAt?: string;
};

export type PersonnelRole = 'ADMIN' | 'MANAGER' | 'VIEWER' | string;
