Vendored client-side libraries (self-hosted so the export buttons work without a third-party CDN):

- `xlsx.min.js` — SheetJS xlsx.js 0.18.5 (Apache-2.0). Used only to *write* workbooks from data this app computed itself — never to parse user-uploaded files, so the known ReDoS/prototype-pollution advisories for untrusted-file parsing don't apply here.
- `jspdf.umd.min.js` — jsPDF 4.2.1 (MIT).
- `jspdf.plugin.autotable.min.js` — jspdf-autotable 5.0.8 (MIT), for the PDF's tables.

Update by re-running `npm install xlsx jspdf jspdf-autotable` in a scratch dir and copying the new `dist/` builds over these files.
