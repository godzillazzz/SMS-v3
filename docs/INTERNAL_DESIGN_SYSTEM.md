# Internal authenticated-app design system

This layer is for the authenticated application shell and shared operational components only.

## Public boundary

Do not use these selectors or tokens to style the landing page, guest/public routes, Login, or authentication screens. Public ownership remains in the existing public/auth stylesheets. `frontend/src/design-system.css` is intentionally scoped under `.app-shell`; it must not add `body`, `:root`, login, landing, or guest selectors.

## Tokens

Use semantic tokens from `frontend/src/styles/tokens.css`: `--color-*` for text, surfaces, borders and status; `--space-*` for rhythm; `--radius-*` and `--shadow-*` for geometry/elevation; `--font-*` and `--line-height-*` for type. Legacy `--sms-*` and compatibility aliases remain supported. Use `--focus-ring` and `--focus-color` for keyboard focus.

## Component contracts

- Button: use existing button classes or `.ds-button`; provide a real `<button>`, preserve `disabled`/`aria-disabled`, and set `aria-busy="true"` or `data-loading="true"` while work is pending.
- Field: use `.ds-field`; associate the label with the control. Use `aria-invalid="true"` and `aria-describedby` for validation and `.ds-field__error` for the message.
- Dialog: use the existing dialog hook/component or `.ds-dialog`; expose `role="dialog"`, an accessible name, and focus management.
- Status/badge: use `.ds-status`, `.ds-badge`, or the existing status-badge component with semantic status tokens.
- Toast/alert: use `.ds-toast`/`.ds-alert`; alerts use `role="alert"` only for urgent errors, otherwise prefer a polite live region.
- Data table/mobile card: keep table semantics in `.ds-table-wrap`; provide an equivalent `.ds-mobile-card` for narrow screens. Existing `ResponsiveDataTable` owns loading, error, empty and mobile boundaries.
- Bottom navigation: use the existing `.mobile-nav`/`.bottom-navigation` shell and preserve safe-area padding and accessible current-page state.
- States: loading uses `aria-busy` and a polite status; empty is explanatory; error uses an assertive alert and a retry action where possible; success uses a semantic success status.

Do not duplicate existing component systems. Add a contract hook/class only when an existing shared component cannot express the state.
