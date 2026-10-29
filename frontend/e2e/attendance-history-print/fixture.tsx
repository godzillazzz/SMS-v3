import React from 'react';
import { createRoot } from 'react-dom/client';
import { AttendanceHistoryPwaPage } from '../../src/pages/pwa-attendance/AttendanceHistoryPwaPage';

createRoot(document.getElementById('root')!).render(<AttendanceHistoryPwaPage token="synthetic" online />);
