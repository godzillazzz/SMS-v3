export type LeavePolicyForm = {
  defaultSickDays: number;
  defaultPersonalDays: number;
  defaultVacationDays: number;
  sickAttachmentRequiredAfterDays: number;
  managerRetroactiveOnBehalfEnabled: boolean;
  managerRetroactiveMaxDaysBack: number;
  supervisorRetroactiveOnBehalfEnabled: boolean;
  supervisorRetroactiveMaxDaysBack: number;
  viewerRetroactiveSelfEnabled: boolean;
  viewerRetroactiveMaxDaysBack: number;

};

export const leavePolicyKeys = {
  defaultSickDays: 'LEAVE_DEFAULT_SICK_DAYS',
  defaultPersonalDays: 'LEAVE_DEFAULT_PERSONAL_DAYS',
  defaultVacationDays: 'LEAVE_DEFAULT_VACATION_DAYS',
  sickAttachmentRequiredAfterDays: 'LEAVE_SICK_ATTACHMENT_REQUIRED_AFTER_DAYS',
  managerRetroactiveOnBehalfEnabled: 'LEAVE_MANAGER_RETROACTIVE_ON_BEHALF_ENABLED',
  managerRetroactiveMaxDaysBack: 'LEAVE_MANAGER_RETROACTIVE_MAX_DAYS_BACK',
  supervisorRetroactiveOnBehalfEnabled: 'LEAVE_SUPERVISOR_RETROACTIVE_ON_BEHALF_ENABLED',
  supervisorRetroactiveMaxDaysBack: 'LEAVE_SUPERVISOR_RETROACTIVE_MAX_DAYS_BACK',
  viewerRetroactiveSelfEnabled: 'LEAVE_VIEWER_RETROACTIVE_SELF_ENABLED',
  viewerRetroactiveMaxDaysBack: 'LEAVE_VIEWER_RETROACTIVE_MAX_DAYS_BACK'
} as const;

export const defaultLeavePolicy: LeavePolicyForm = {
  defaultSickDays: 30,
  defaultPersonalDays: 3,
  defaultVacationDays: 6,
  sickAttachmentRequiredAfterDays: 3,
  managerRetroactiveOnBehalfEnabled: true,
  managerRetroactiveMaxDaysBack: 0,
  supervisorRetroactiveOnBehalfEnabled: true,
  supervisorRetroactiveMaxDaysBack: 0,
  viewerRetroactiveSelfEnabled: false,
  viewerRetroactiveMaxDaysBack: 0
};
