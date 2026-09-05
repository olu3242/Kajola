# R2-R8 dependency risk triage

Evidence: `npm audit --omit=dev`, 2026-09-05. Result: 33 vulnerable dependency instances: 16 high, 17 moderate, 0 critical. No finding is suppressed.

## High findings

| Package / advisory | Kajola path | Classification | Control and decision |
|---|---|---|---|
| `image-size` GHSA-w3rx-r6r6-pgpr | Expo/Metro asset build parser | NOT_REACHABLE | Runtime users cannot submit build assets. Keep builds restricted to trusted repository assets; Expo 57 upgrade remains required before accepting untrusted assets. |
| `image-size` GHSA-5p2g-fcmc-qvqq | Expo/Metro asset build parser | NOT_REACHABLE | Same trusted-build boundary; breaking Expo upgrade tracked. |
| `ip` GHSA-2p57-rm9w-gvfp | React Native CLI doctor/Hermes tooling | NOT_REACHABLE | CLI-only path is not shipped in web or mobile runtime. Upgrade with the Expo/RN compatibility program. |
| `next` GHSA-9g9p-9gw9-jx7f | Image optimizer remote patterns | NOT_REACHABLE | No `remotePatterns` or remote image domains; Kajola uses repository-owned assets. |
| `next` GHSA-h25m-26qc-wcjf | App Router RSC request handling | PILOT_BLOCKING | Public App Router is reachable. Requires supported Next upgrade or independently verified edge request limits before R9. |
| `next` GHSA-ggv3-7p47-pfv8 | Configured rewrites | NOT_REACHABLE | `next.config.mjs` defines no rewrites. |
| `next` GHSA-3x4c-7xq6-9pq8 | Image optimizer disk cache | MITIGATED | Only local assets and framework width allow-list are used. Add CDN request limits and upgrade before broad launch. |
| `next` GHSA-q4gf-8mx6-v5v3 | App Router RSC | PILOT_BLOCKING | Public RSC path is reachable; framework upgrade/edge mitigation required. |
| `next` GHSA-8h8q-6873-q5fj | App Router RSC | PILOT_BLOCKING | Public RSC path is reachable; framework upgrade/edge mitigation required. |
| `next` GHSA-3g8h-86w9-wvmq | Middleware redirect caching | PILOT_BLOCKING | Kajola uses middleware for page access. Prove CDN non-caching behavior or upgrade. |
| `next` GHSA-ffhc-5mcf-pf4q | App Router CSP nonce handling | NOT_REACHABLE | Kajola does not configure CSP nonces. |
| `next` GHSA-vfv6-92ff-j949 | RSC cache-busting collisions | PILOT_BLOCKING | Public App Router is reachable; upgrade required. |
| `next` GHSA-gx5p-jg67-6x7h | `beforeInteractive` with untrusted input | NOT_REACHABLE | No `next/script` or `beforeInteractive` usage. |
| `next` GHSA-h64f-5h5j-jqjh | Image optimizer DoS | MITIGATED | Local fixed assets only; rate limiting and upgrade remain launch controls. |
| `next` GHSA-c4j6-fc7j-m34r | WebSocket upgrade SSRF | NOT_REACHABLE | No WebSocket upgrade proxy or custom server. |
| `next` GHSA-wfc6-r584-vfw7 | RSC response cache poisoning | PILOT_BLOCKING | Public App Router is reachable; upgrade or vendor-approved mitigation required. |
| `next` GHSA-36qx-fr4f-26g5 | Pages Router i18n middleware bypass | NOT_REACHABLE | App Router only; no i18n configuration. |
| `next` GHSA-m99w-x7hq-7vfj | App Router Server Actions DoS | NOT_REACHABLE | No `use server` actions; mutations use route handlers. |
| `next` GHSA-89xv-2m56-2m9x | Server Action SSRF on custom servers | NOT_REACHABLE | No Server Actions and no custom server. |
| `next` GHSA-68g3-v927-f742 | request-body cache confusion | PILOT_BLOCKING | Framework request handling is reachable; upgrade or verified cache bypass required. |
| `next` GHSA-4633-3j49-mh5q | invalid UTF-8 request cache confusion | PILOT_BLOCKING | Framework request handling is reachable; upgrade or verified cache bypass required. |
| `next` GHSA-4c39-4ccg-62r3 | Edge Server Action payload | NOT_REACHABLE | No Server Actions. |
| `next` GHSA-p9j2-gv94-2wf4 | attacker-controlled rewrite destination | NOT_REACHABLE | No rewrites. |
| `next` GHSA-955p-x3mx-jcvp | internal Server Function disclosure | NOT_REACHABLE | No Server Actions/Functions. |
| `postcss` GHSA-qx2v-qp2m-jg93 | trusted CSS build pipeline | NOT_REACHABLE | Users cannot submit CSS; PostCSS is not invoked on runtime input. |
| `postcss` GHSA-6g55-p6wh-862q | source-map file read during build | NOT_REACHABLE | Builds consume trusted repository CSS only. |
| `postcss` GHSA-fxqj-rqcc-2cmp | source-map file read during build | NOT_REACHABLE | Builds consume trusted repository CSS only. |
| `postcss` GHSA-r28c-9q8g-f849 | source-map path traversal during build | NOT_REACHABLE | Builds consume trusted repository CSS only. |

## Moderate findings

`decode-uri-component`, `fast-xml-parser`, and `uuid` are transitive Expo/React Native tooling paths. They are not part of the Kajola web transactional runtime. They remain `UPGRADE_REQUIRED` through a tested Expo/RN upgrade rather than an unreviewed forced install.

## Decision

Do not run `npm audit fix --force`: it proposes breaking Next 16 and Expo 57 upgrades. The reachable Next.js advisories are `PILOT_BLOCKING`; R9 requires a tested upgrade or deploy-time controls with executable verification.
