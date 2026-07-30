export type PersonnelRecord = {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  department?: string;
  jobTitle?: string;
  isActive: boolean;
};

export type PersonnelRole = 'ADMIN' | 'MANAGER' | 'VIEWER' | string;
