export type RegistrationMachineState =
  | 'REQUEST_SUBMITTED'
  | 'REQUEST_PENDING'
  | 'EXISTING_ACCOUNT'
  | 'EMPLOYEE_ALREADY_HAS_ACCOUNT'
  | 'REQUEST_REJECTED'
  | 'REGISTRATION_SUPPORT_REQUIRED';

export type RegistrationResultTone = 'warning' | 'info' | 'danger' | 'attention';

export type RegistrationResultPresentation = {
  state: RegistrationMachineState;
  heading: string;
  body: string;
  statusLabel?: string;
  tone: RegistrationResultTone;
  recovery: boolean;
};

const registrationResults: Record<RegistrationMachineState, Omit<RegistrationResultPresentation, 'state'>> = {
  REQUEST_SUBMITTED: {
    heading: 'คำขอลงทะเบียนถูกส่งแล้ว',
    body: 'ผู้ดูแลระบบจะตรวจสอบคำขอของคุณก่อนเปิดสิทธิ์เข้าใช้งาน',
    statusLabel: 'รอการตรวจสอบ',
    tone: 'warning',
    recovery: false
  },
  REQUEST_PENDING: {
    heading: 'คำขอนี้อยู่ระหว่างการตรวจสอบแล้ว',
    body: 'ไม่จำเป็นต้องส่งคำขอใหม่ กรุณารอผลการตรวจสอบจากผู้ดูแลระบบ',
    statusLabel: 'อยู่ระหว่างการตรวจสอบ',
    tone: 'warning',
    recovery: false
  },
  EXISTING_ACCOUNT: {
    heading: 'อีเมลนี้มีบัญชีใช้งานในระบบแล้ว',
    body: 'คุณสามารถเข้าสู่ระบบ หรือใช้ลืมรหัสผ่านหากไม่สามารถเข้าบัญชีได้',
    tone: 'info',
    recovery: true
  },
  EMPLOYEE_ALREADY_HAS_ACCOUNT: {
    heading: 'ข้อมูลนี้มีบัญชีผู้ใช้งานในระบบแล้ว',
    body: 'หากไม่สามารถเข้าใช้งานได้ ให้ใช้ลืมรหัสผ่านหรือติดต่อผู้ดูแลระบบ',
    tone: 'info',
    recovery: true
  },
  REQUEST_REJECTED: {
    heading: 'คำขอลงทะเบียนนี้ไม่สามารถดำเนินการต่อได้',
    body: 'กรุณาติดต่อผู้ดูแลระบบของหน่วยงานเพื่อขอคำแนะนำเพิ่มเติม',
    tone: 'danger',
    recovery: false
  },
  REGISTRATION_SUPPORT_REQUIRED: {
    heading: 'ไม่สามารถดำเนินการลงทะเบียนได้ในขณะนี้',
    body: 'กรุณาติดต่อผู้ดูแลระบบของหน่วยงาน',
    tone: 'attention',
    recovery: false
  }
};

export function registrationResultPresentation(state?: string): RegistrationResultPresentation | undefined {
  if (!state || !(state in registrationResults)) return undefined;
  const typedState = state as RegistrationMachineState;
  return { state: typedState, ...registrationResults[typedState] };
}
