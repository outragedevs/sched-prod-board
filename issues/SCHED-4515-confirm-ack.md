---
id: SCHED-4515
title: Ack asks to confirm and names the incident
status: done
plan: R2
---

Product decision after the step-one recording: at 00:09 a new incident landed on top while on-call aimed at
INC-3343, the rows moved down, and the click acked INC-5504. New incidents stay live at the top and Ack stays on
the row, but Ack now asks to confirm, and the confirm names the incident id.

- Ack opens a confirm (`data-testid="confirm"`) naming the incident id, its severity, service, region and summary.
- `confirm-ack` sends the ack and marks the row; `confirm-cancel`, Escape or a click outside acks nothing.
- Refreshes keep running while the confirm is open; the confirm stays bound to the row that was clicked.

Acceptance: a click that lands on a shifted row shows the wrong id in the confirm, and Cancel leaves it un-acked.
