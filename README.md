# LWH Transportation Manager

One installable app (PWA) with everything a transportation manager needs. Drivers use the Driver Toolkit, the shop uses the Trailer Shop, and managers use this.

| Home screen tile | What it is | Sign-in |
|---|---|---|
| **Unpaid Time Off** | Pending requests with Approve / Deny, Who's Out (next 30 days), each driver's history, all requests, CSV export, "Manage drivers" opens the Drivers list | Each manager's own Time Off PIN |
| **Drivers** | The master driver list for every app: add drivers, fix names, set the name a driver goes by (Paul Bay, AJ Thompson; payroll keeps the legal name), Driver ID, truck type, location, start date, mark inactive. Changes reach payroll, Unpaid Time Off and the trailer inspection list within the hour. No pay rates here. | The manager passcode (same as Recruiting credits) |
| **PTO Approvals** | Opens the existing PTO manager dashboard in a new tab | That system's own Google sign-in |
| **Driver & Trailer Tracking** | Opens the Driver & Trailer Tracking app in a new tab | That app's own |
| **Driver Messages** | The Driver Message Center, right in this app: messages from drivers (Needs attention), send to everyone / by location / picked drivers with BOLs, PDFs and photos, read receipts, reminders, recall, and driver setup codes and PIN resets. A red number on the tile shows driver messages that need attention. | Driver ID + 6-digit PIN (anyone set as Manager in the driver list) |
| **Trailer Inspections** | The Trailer Shop's manager side: inspections and the 5-step review, Shop Analytics, Driver & Location, Trailer History, Trailer Map | The Dashboard PIN (Config tab) |
| **Shop Inventory** | Trailer shop parts in Supabase: Stock (on hand, bins, reorder points, low stock, not-counted flags, CSV), Receive (PO, vendor, qty, cost), Count (walk the shelves on a phone), Activity (every change: used on which trailer / WO by which tech, received, counted, adjusted), Import (paste from a Sheet or a CSV, or load a starter list). The red number on the tile is parts at or below their reorder point. | The Transportation Manager sign-in |
| **Dispatch Board** | Moved from the Driver Toolkit: yard checks by day, Yards Now, Find a trailer, Recruiting | None (Recruiting credits still need the recruiting passcode) |
| **All Timesheets** | Moved from the Driver Toolkit | None |
| **Fuel Prices** | Moved from the Driver Toolkit | None |
| **Fuel Surcharge** | The Toolkit's surcharge calculator (OOIDA method) with this week's EIA diesel price | None |

A red number on the Unpaid Time Off tile shows how many requests are waiting.

Sign-ins last 8 hours on each phone, so a manager enters a PIN about once a day. The Sign out buttons are at the bottom of the home screen.

## No backend changes
Everything talks to the same Google Sheets and Apps Scripts as today:
- **Time off:** the Time Off app's script. Emails and Outlook invites work the same.
- **Trailers:** the Trailer Defect Inspection script, with the Api.gs and ShopApi.gs you already deployed for the Trailer Shop.
- **Dispatch, timesheets, recruiting:** the same Supabase functions the Toolkit uses.
- **Fuel prices:** EIA.

The addresses are in `config.js`.

## Shop Inventory
- Stock is kept at two locations: **Trailer Shop** and **Off-Site Shop** (the portable building on the customer trailer yard). Locations live in `shop_locations`, so adding one later is one insert.
- Tables: `shop_parts` (what the part is), `shop_stock` (on hand, bin, reorder point and last count per location), `shop_stock_moves` (every change, with its location), `shop_session_parts`. Functions `shop_*` in `supabase/migrations/20261122b_shop_inventory_locations.sql` (applied; it replaced the first, still-empty version).
- Stock tab shows both locations side by side with a total; filter to one location. A part's window shows each location, lets you count / adjust / receive at either one, and **Move to other location** (a transfer writes a move at both).
- Receive, Count and Import each pick a location. Import can also read a Location column ("Shop", "Off-Site", "Building" all work).
- The Trailer Shop tech app (v1.4.0) shows both counts, and each part on a repair has a **From: Trailer Shop / Off-Site Shop** pick (it remembers the tech's last one). Saving the repair takes the part off that location.

## Dispatch Board > Weekly Plan
- The dispatcher's weekly driver sheet (the "charcuterie board" workbook) as a week calendar: drivers grouped the way the sheet groups them, a column per day with load #s as chips (tap to copy), loads per day, who's off, a BULLPEN section for loads with no driver yet, search across driver / truck / load # / city, and a Day view for phones. Read-only: planning stays in the sheet.
- Spotters show like the drivers: their post (PERNOD AM, GLAT…) under each weekday. OFF typed in a day or its NOTES column shows as off for anyone; for a spotter it also says **Needs cover** until a name is typed in that day's column (then "Covering: name"). All-caps names display in normal case.
- Feed: `gas/DispatchExtract.gs` replaces the Dispatch Extract project's Code.gs. It still writes Dispatch_Extract exactly as before, then sends the last 10 weeks of tabs to `dispatch_plan_push` (key in Script Properties `DISPATCH_SYNC_KEY`; only its sha256 is stored in `dispatch_plan_sync`). It also picks up Saturday/Sunday and the bullpen rows, which the sheet extract skips.
- Tables / functions: `dispatch_plan`, `dispatch_plan_sync`, `dispatch_plan_push`, `dispatch_plan_week` in `supabase/migrations/20261122c_dispatch_plan.sql` (applied).

## Setup (GitHub Pages)
1. Create a repo, for example `nbr1hawgfan/LWH_Transportation_Manager`.
2. Upload everything in this folder.
3. Go to **Settings → Pages → Deploy from branch → main / root**.
4. Send Chris and Derek the link. They open it on their phones and tap **⤓ Install** at the top (iPhone: Share → Add to Home Screen).

Bookmarks that open one section directly: `…/#timeoff`, `…/#trailers`, `…/#dispatch`. These also show up when you long-press the installed app icon on Android.

## After managers are using it
- **Driver Toolkit:** remove the hidden manager tools (Dispatch Board, All Timesheets, Fuel Price Board) and the Settings unlock code.
- **Trailer Shop:** can become tech-only.
- **Time Off app:** drivers now request in the Toolkit and managers approve here, so the standalone app can be retired when you're ready.

## Updating
After pushing changes, bump `VERSION` in `sw.js` so phones pick up the new files.
