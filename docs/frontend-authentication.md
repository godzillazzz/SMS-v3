# Frontend authentication

The browser sends `clientType: "browser"`. Login and refresh return a short-lived access token in JSON, held in React memory only. The refresh token is never returned in browser JSON; it is stored in the `HttpOnly` `smsv3_refresh` cookie. The readable `smsv3_csrf` cookie supplies the matching `X-CSRF-Token` header for refresh and logout requests.

In development, cookies are not marked Secure so localhost works. In production they are always `Secure`, `HttpOnly`, `SameSite=Lax`, and scoped to `/api/v1/auth`. Do not use `localStorage` or `sessionStorage` for either token. A mobile client sends `clientType: "mobile"` explicitly and continues to receive its refresh token in JSON for platform-secure storage.
