# Split Control

Open an event in Split Control's Live desk. Add this connection in Companion and enter the host, HTTP port (5657) and Socket.IO port (5656).

If Companion runs on another computer, also enter the **access key**: copy it from Split Control → Settings → Remote access. Without it the connection shows "Access key required". Companion on the same computer as Split Control needs no key.

Buttons work like the desk: load something into Preview, then Show it.

- **Favourites** (saved on the desk with F) appear as presets, one per favourite. "Load into Preview" prepares it; press Show to put it on air. "Straight to air" does both. A favourite button turns red while its graphic is on air.
- **Transport**: Show, Update, Hide (most recent), Hide all, Page ◀ / ▶. Show turns green while something is prepared in Preview.
- **Runner graphics**: load a runner identity, runner start or runner splits by real or virtual bib.
- **Hide one graphic**: take a single graphic (e.g. Results table) off air.

Variables: event name, graphics on air, what is prepared in Preview, and data/output status.

Keep both computers on the same trusted production network. The access key travels unencrypted (plain HTTP), so it keeps out other devices on the network, not someone who can watch the traffic. Make a new key in Settings if it leaks.
