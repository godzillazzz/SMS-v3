export type LeavePolicyForm = {
  defaultSickDays: number;
  defaultPersonalDays: number;
  defaultVacationDays: number;
  sickAttachmentRequiredAfterDays: number;
  managerRetroactiveOnBehalfEnabled: boolean;
  managerRetroactiveMaxDaysBack: number;
};

export const leavePolicyKeys = {
  defaultSickDays: 'LEAVE_DEFAULT_SICK_DAYS',
  defaultPersonalDays: 'LEAVE_DEFAULT_PERSONAL_DAYS',
  defaultVacationDays: 'LEAVE_DEFAULT_VACATION_DAYS',
  sickAttachmentRequiredAfterDays: 'LEAVE_SICK_ATTACHMENT_REQUIRED_AFTER_DAYS',
  managerRetroactiveOnBehalfEnabled: 'LEAVE_MANAGER_RETROACTIVE_ON_BEHALF_ENABLED',
  managerRetroactiveMaxDaysBack: 'LEAVE_MANAGER_RETROACTIVE_MAX_DAYS_BACK'
} as const;

export const defaultLeavePolicy: LeavePolicyForm = {
  defaultSickDays: 30,
  defaultPersonalDays: 3,
  defaultVacationDays: 6,
  sickAttachmentRequiredAfterDays: 3,
  managerRetroactiveOnBehalfEnabled: true,
  managerRetroactiveMaxDaysBack: 0
};
