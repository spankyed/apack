# Three-platform qualification at487011c484 — 2026-10-31

App acceptance run41181673785 is terminal success on exact rebased source487011c484.
Actual downloaded artifacts, not only job labels, verify Linux x64 and macOS arm64
766EARS passes with zero skips; Windows x64 has761passes and five explicit platform
skips. The full named inventory is retained in summary.json. All hosts pass735native
membership controls. Linux also passes1320SDK cases and all four actual ENOSPC cases.
The verification reports retain host, archive, profile, crash, managed publication and
normal native generation/training/audit counts. Original test deadlines are unchanged.

All seven cases that timed out in the post-migration local full run pass on both Linux
and macOS CI. Their local failures and kernel-wait observation remain preserved under
prefix-rebase-validation/; different hardware/storage does not establish a single causal
fix. Corrected native coverage and query-cost evidence remain under prefix-followup/.
The runtime is unchanged by the subsequent a9c9340df7 evidence/docs checkpoint.

This does not make the final strict concurrency failure, editor activation, broad-query/
vector responsiveness, native canonical signed-zero finding or remaining goal criteria
pass. These CI filesystems/architectures do not certify arbitrary filesystems, power-loss
behavior or all installed app architectures. The candidate remains draft, not adopted.
