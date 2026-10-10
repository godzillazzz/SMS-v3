import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/kanit/thai-400.css';
import '@fontsource/kanit/thai-600.css';
import '../../src/styles.css';
import '../../src/styles/tokens.css';
import '../../src/styles/layout-foundation.css';
import { PersonnelDirectoryPage } from '../../src/pages/personnel/PersonnelDirectoryPage';

document.documentElement.dataset.theme = 'light';

createRoot(document.getElementById('root')!).render(
  <div className="app-shell">
    <aside className="sidebar" aria-hidden="true" />
    <div className="main-area">
      <header className="topbar"><div className="breadcrumb">ข้อมูลพนักงาน</div></header>
      <main className="content-area">
        <PersonnelDirectoryPage
          token="readiness-fixture-token"
          refreshKey={0}
          canManage
          role="ADMIN"
          onAdd={() => undefined}
          onReviewChanges={() => undefined}
          onEdit={() => undefined}
        />
      </main>
    </div>
  </div>
);
