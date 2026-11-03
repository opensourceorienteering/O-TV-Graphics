# SOFT — Runner presentations

An experimental graphic in the Svensk Orientering (`sof`) look. It uses a normal start list
and lets the operator present a chosen subset of runners, one at a time.

1. Choose the Svensk Orientering look for the event and load its timing/start list.
2. In Live, choose **Runner presentations**, then the class and rows per page.
3. Start-list favourites are selected automatically. Under **Runners to present**, search by name, club or bib and tick the runners you want.
   Untick any favourite you want to skip; Clear selection presents nobody.
   If the local start list is empty, use **Load runners from timing**.
4. **Show** opens the first page as an ordinary start list, with nobody highlighted.
5. **Next page / →** lifts the first selected runner above the visible list, with a shadow and yellow name.
   Each subsequent Next fades the previous name back to normal and focuses the next pick.
6. After the selected runners on a page, Next shows the next page normally, then presents its
   selected runners. Pages without selected runners still appear once as normal start lists.
7. One final Next clears the final highlight. The list stays on air until **Hide**.
   **Previous / ←** walks the same sequence backwards; **First page** resets to the normal
   first page. The on-air step count includes both focus steps and actual page changes.

Runners are presented in start-list order, regardless of the order you ticked them. No picks
means an ordinary paged start list. A selection is saved with the draft/favourite. The
picker distinguishes identical names from different clubs and works without bibs.

The graphic holds its timing data by default and ignores automatic page timers. Pick runners
before going on air; to change the on-air selection or timing data, edit Preview and press
**Update**. Changing selection/rows during a presentation rebuilds the sequence at the current
step; hide and show again to restart from a normal list.

The package is hand-made in `templates/sets/sof/sof-runner-presentations/`, so regenerating
the standard template catalogue leaves it in place. It is declared only in SOFT's manifest;
other looks do not gain this entry. To try it in an installed app, import the updated complete
SOFT look zip in Graphics library, then select the Svensk Orientering look.
