export type PersonnelRecord = {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  displayName?: string;
  department?: string;
  jobTitle?: string;
  isActive: boolean;
  updatedAt?: string;
};

export type PersonnelRole = 'ADMIN' | 'MANAGER' | 'VIEWER' | string;
