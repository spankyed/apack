# Host timeout resolved; subprocess inventory incomplete

App-and-rest job 124598037130 in [41220296120](https://github.com/spankyed/apack/actions/runs/41220296120), source `836a3d997c`, is terminal failure. Its host pool completes in **400.7s**, within the unchanged 600s suite deadline: 564 files pass, four skip, and one fails. The failure is solely `subprocess-inventory.spec.ts`, which discovers the two newly moved host integration files absent from its reviewed inventory (one and two spawn sites). Other parent-run jobs remain active at the observation; this is not overall strict acceptance.

The correction registers those exact files/counts with explicit reasons: actual process death at publication/restoration boundaries and independent live reader/writer exclusion cannot be emulated in the surviving test worker. No detector, inventory equality check, test assertion or deadline is weakened. Raw job, step and per-file progress logs accompany uncompressed-byte receipts.
