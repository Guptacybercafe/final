# Gupta Cyber Cafe website + auto-print

## Run it (on the shop laptop connected to the printers)
1. Install Node.js LTS from nodejs.org
2. Open this folder in a terminal and run:  npm install
3. Start:  npm start
4. Website: (https://gupta-cyber-cafe.onrender.com/)  Admin: (https://gupta-cyber-cafe.onrender.com/admin.html)
   Default admin password: admin123  (change it on first login)

## Billing
The home page has a Billing section (public/billing.js): build a bill, print it, download a PDF, send it on WhatsApp, export all bills as CSV. Saved bills are kept only in the browser used on the shop computer (localStorage).

## Two printers
Admin > choose the Colour printer and the Black & White printer from the dropdowns,
press "Print test page" on each, then "Save printer settings".
Customers pick Colour or B&W; the file goes to the matching printer.
Turn "Auto-print new uploads" on for fully automatic printing, or off to approve each job.

## Other computers on the same Wi-Fi
Open http://<laptop-IP>:3000 (find the IP with ipconfig). To accept uploads from the internet,
use a tunnel such as Cloudflare Tunnel, and expose only the website, not /admin.html.

## Notes
- Uploads: PDF, JPG, PNG (images are wrapped in an A4 PDF). Printed jobs are auto-deleted after 3 days.
- Free tools run in the visitor's browser and load their libraries from cdnjs, so they need internet.
- Windows printing uses the pdf-to-printer package; Linux/Mac use the "lp" command.
- Mining-related services were removed from the catalogue (public/services.js).
