import React from 'react';
import { createRoot } from 'react-dom/client';
import { AccessManagementPage } from '../src/pages/access-management/AccessManagementPage';

const account = {
  id: 'employee-account-1',
  displayName: 'Controlled Test Account',
  role: 'VIEWER',
  department: 'WCS',
  accountStatus: 'ACTIVE',
  isActive: true,
  passwordResetRequired: false,
  createdAt: '2026-09-01T00:00:00.000Z'
};

createRoot(document.getElementById('root')!).render(<AccessManagementPage
  rows={[account]}
  loading={false}
  role="ADMIN"
  onRefresh={() => {}}
  onUpdate={async () => {}}
  onResetPassword={async () => {}}
  onViewAs={async () => {}}
  onOpenAudit={() => {}}
/>);
