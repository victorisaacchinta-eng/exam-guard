# Design notes

The site borrows from two things that already exist around exam papers.

**OMR answer sheets.** White stock, magenta drop-out ink, black timing marks down the edge, bubbles filled in pencil. A SHA-256 fingerprint is 64 hex characters, so it maps onto a 64-question sheet with 16 options (0 to f). The file's fingerprint is pencilled in; the sealed fingerprint is the answer key, and every wrong row gets the right bubble circled in red pen. This is also the clearest way I found to show why one changed number in a PDF changes almost the whole hash.

**Tamper-evident seal tape.** Blue tape with a serial number when intact, red tape that leaves a VOID pattern when it has been peeled. The verdict is drawn as that label: serial is the start of the transaction hash, the date line is the block time.

## Tokens

| Token | Value | Taken from |
|---|---|---|
| `--paper` | #FAFAF7 | OMR sheet stock |
| `--field` | #FBE9F2 | drop-out ink at about 8%, the band behind the checker |
| `--dropout` | #D6338A | OMR drop-out ink |
| `--graphite` | #1C1C20 | HB pencil and print black |
| `--seal-blue` | #1E56B8 | blue security seal tape |
| `--seal-red` | #CE1F2A | red security seal tape |
| `--pen-red` | #C4161C | examiner's red pen |

Type: Big Shoulders Display for headings (condensed, like stencilled packet markings; the Stencil cut is only in the wordmark), Schibsted Grotesk for text, Fragment Mono only for hashes and code. All three are OFL and load from Google Fonts.

Corners are square everywhere except the bubbles. Motion is limited to three places: the sheet pencils its 64 rows in order (about half a second), the seal label scales in from 0.97, and the VOID pattern wipes across a broken seal. `prefers-reduced-motion` turns all three off.
