export type AccountStatus = 'ACTIVE' | 'PENDING' | 'SUSPENDED' | 'REJECTED' | string;

export type AccountRecord = {
  id: string;
  displayName?: string;
  role?: string;
  department?: string | null;
  accountStatus?: AccountStatus;
  isActive?: boolean;
  passwordResetRequired?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type AccessRole = 'ADMIN' | 'MANAGER' | 'VIEWER' | string;

export function canLoadAccessManagement(role: AccessRole) {
  return role === 'ADMIN' || role === 'MANAGER';
}

export const viewAsConfirmation = {
  title: 'ดูในมุมมองผู้ใช้แบบอ่านอย่างเดียว',
  description: 'คุณจะเปิดมุมมองของบัญชีนี้แบบอ่านอย่างเดียวและมีระยะเวลาจำกัด การแก้ไขข้อมูลจะยังถูกปฏิเสธโดยระบบ',
  confirmLabel: 'ยืนยัน View As',
  failureMessage: 'ไม่สามารถเปิดมุมมองผู้ใช้ได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง'
} as const;

export async function executeConfirmedViewAs(targetId: string, onViewAs: (id: string) => Promise<unknown>) {
  try {
    await onViewAs(targetId);
    return { ok: true } as const;
  } catch {
    return { ok: false, error: viewAsConfirmation.failureMessage } as const;
  }
}

export function isAccountActive(account: AccountRecord) {
  return account.isActive === true && account.accountStatus === 'ACTIVE';
}

export function accountStatusLabel(account: AccountRecord) {
  if (account.accountStatus === 'PENDING') return 'รออนุมัติ';
  if (account.accountStatus === 'SUSPENDED' || account.isActive === false) return 'ระงับใช้งาน';
  if (account.accountStatus === 'REJECTED') return 'ไม่อนุมัติ';
  return isAccountActive(account) ? 'ใช้งานอยู่' : 'ไม่พร้อมใช้งาน';
}

export function accountStatusTone(account: AccountRecord) {
  if (account.accountStatus === 'PENDING') return 'pending';
  if (account.accountStatus === 'SUSPENDED' || account.isActive === false || account.accountStatus === 'REJECTED') return 'suspended';
  return 'active';
}

export function accessSummary(accounts: AccountRecord[]) {
  return {
    total: accounts.length,
    active: accounts.filter(isAccountActive).length,
    pending: accounts.filter((account) => account.accountStatus === 'PENDING').length,
    suspended: accounts.filter((account) => account.accountStatus === 'SUSPENDED' || account.accountStatus === 'REJECTED').length,
    resetRequired: accounts.filter((account) => account.passwordResetRequired).length
  };
}

export function visibleAccountActions(role: AccessRole, account: AccountRecord, originalUserId?: string) {
  if (role === 'MANAGER') return account.accountStatus === 'PENDING' ? ['approve', 'details'] : ['details'];
  if (role !== 'ADMIN') return [];
  const actions = ['details', 'edit', 'reset-password'];
  if (account.id !== originalUserId && isAccountActive(account) && !account.passwordResetRequired) actions.push('view-as');
  actions.push(isAccountActive(account) ? 'suspend' : 'activate');
  return actions;
}

export function accessState(loading: boolean, error?: string, rows: AccountRecord[] = []) {
  if (loading) return 'loading';
  if (error) return 'error';
  if (rows.length === 0) return 'empty';
  return 'ready';
}

export function accessManagementState(role: AccessRole, loading: boolean, error?: string, rows: AccountRecord[] = []) {
  if (!canLoadAccessManagement(role)) return 'permission-denied';
  return accessState(loading, error, rows);
}
