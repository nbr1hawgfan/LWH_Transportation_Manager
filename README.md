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
- Tables `shop_parts`, `shop_stock_moves`, `shop_session_parts` and the `shop_*` functions in `supabase/migrations/20261122_shop_inventory.sql` (already applied to Supabase).
- On hand lives on the part and every change writes a move, so any count can be traced back.
- The Trailer Shop tech app (v1.3.0) has a Parts Stock tab, and its Parts Used rows pick from this list. Saving a repair sets that repair's parts: saving twice doesn't deduct twice, and removing a part from the repair puts it back on the shelf. Typed-in parts that aren't on the list are still saved on the work order, they just don't touch stock.
- Getting started: Import > Load a starter list (or paste Chris's sheet) as **Names only**, then do a Count. Counts stay "not counted" until someone counts them, so a stale list never looks right when it isn't.

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
