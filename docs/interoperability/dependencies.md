# Integration dependencies

External integrations that require official specifications or agreements before implementation. Nothing here may be implemented from assumed or invented specifications.

| Integration | Needed for | Spec source | Version | Status |
| --- | --- | --- | --- | --- |
| PhilHealth member / eligibility | Registration, billing | Not yet obtained | — | Dependency |
| PhilHealth eClaims | Billing / claims | Not yet obtained | — | Dependency |
| PhilHealth YAKAP workflows | Primary care, claims | Not yet obtained | — | Dependency |
| DOH reporting | Government reporting | Not yet obtained | — | Dependency |
| SMS provider | Notifications (`ChannelSender` for `sms`) | Provider not selected | — | Dependency — production uses `UnconfiguredSender` |
| Payment provider | Billing | Provider not selected | — | Dependency |
| Telemedicine video (e.g. LiveKit) | Telemedicine | Provider not selected | — | Dependency |
| Push provider (e.g. Expo push) | Notifications (`ChannelSender` for `push`) | Provider not selected | — | Dependency — production uses `UnconfiguredSender` |
