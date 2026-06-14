# Parking Lot

Deferred ideas that may be useful after the core patient explorer, portal connection, and referral workflows are stable.

## Device-to-Device Vault Transfer

Explore direct transfer of an encrypted vault bundle between a user's devices without storing patient data on fhir4px infrastructure.

Options to evaluate:

- WebRTC data channel: pair two browser sessions with a QR code or short code, then transfer an encrypted vault bundle peer-to-peer.
- Local network transfer: use same-Wi-Fi discovery or pairing when browser and platform constraints allow it.
- Manual encrypted export/import: keep as the simple baseline for MVP because it is reliable and easy to explain.

Open questions:

- How much signaling is required for WebRTC, and can QR-based signaling avoid a relay server for common cases?
- How often will clinic, school, or enterprise firewalls block WebRTC connectivity?
- Should passkey/WebAuthn PRF unlock be required before importing a transferred vault?
- What size limits matter for mobile browsers and older devices?

## User-Managed Cloud Files

Consider allowing users to store encrypted vault bundles in cloud storage they control, such as iCloud Drive, Google Drive, OneDrive, Dropbox, or local files synced by the OS.

This would not make fhir4px a custodian of readable patient data if:

- The bundle is encrypted locally before it leaves the browser.
- The decryption key never leaves the user's device or passkey-derived unlock flow.
- The cloud provider only receives ciphertext.

Open questions:

- Should this be manual file save/open only, or integrate with file picker APIs where available?
- How should conflict handling work if two devices update the vault independently?
- Can we keep metadata minimal enough that filenames and timestamps do not leak sensitive health context?
- What UX makes it clear that cloud-file recovery depends on the user retaining access to the encrypted file and unlock key?
