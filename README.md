# Expert Portal

One site, one login, one Supabase project (`ogvltuavclcgbxlyxkhs`) for two modules:

- `/` - portal shell: sign in (username -> `<username>@cot.app`), left menu with the modules each person may open, and Admin -> Users & Access.
- `/outstanding/` - Customer Outstanding (single-file app, same code as the customer-outstanding repo).
- `/payments/` - Payment Request (placeholder until the module is ported, Phase 5).

All pages are on one origin, so the Supabase session is shared. Module access comes from `mods` in each person's users doc (`out`, `pay`); the portal reads it with the `my_profile()` RPC.

`index.html` is built from `shell.template.html` by `./build.sh` (it inserts the public anon key). Edit the template, then run the script.
GitHub Pages: branch `main`, root folder.
