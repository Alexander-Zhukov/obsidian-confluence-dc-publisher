# Confluence DC Publisher

Publishes Obsidian folders to Confluence Data Center. Embedded images become page attachments; callouts and code blocks become native macros.

Data Center only — requests go to `/rest/api` and the base URL is used as given, without the Cloud `/wiki` prefix.

## Install

**BRAT:** install [BRAT](https://github.com/TfTHacker/obsidian42-brat), run *Add beta plugin*, enter this repository path.

**Manual:** copy `main.js` and `manifest.json` into `<vault>/.obsidian/plugins/confluence-dc-publisher/`, then enable the plugin in Settings → Community plugins.

## Settings

| Field | Value |
|---|---|
| Base URL | `https://confluence.example.com` |
| Username | Confluence login |
| API token | API token, not an account password |
| Root page id | Target page that receives the folder tree |
| Vault folder | Folder to publish; empty publishes the whole vault |

Run **Publish folder to Confluence** from the command palette.

## Conversion

| Markdown | Confluence |
|---|---|
| Headings, lists, tables, quotes | `h1`–`h6`, `ul`, `ol`, `table`, `blockquote` |
| Bold, italic, `~~strikethrough~~` | `strong`, `em`, `del` |
| Fenced code blocks | `code` macro with language |
| `> [!note]` callouts | `info` / `tip` / `note` / `warning` macros |
| `- [ ]` / `- [x]` | ☐ / ☑ |
| Single newline inside a paragraph | `<br />`, or a space when *Strict line breaks* is on in Settings → Editor |
| Two trailing spaces or trailing `\` | `<br />` in either mode |
| `<br>` (e.g. line breaks inside a table cell) | `<br />` |
| `\|` inside a table cell | literal `\|`, also within inline code |
| `![[image.png\|200]]` | attachment + `ac:image` |
| `[[Note]]`, `[[Note\|label]]` | `ac:link` to the page |
| YAML frontmatter | stripped |

## Structure

Subfolders become pages, notes become their children. A file starting with `_` becomes the body of its own folder's page instead of a separate child. Page titles come from file names.

Publishing is idempotent: pages are matched by title and updated, existing attachments are skipped.

## Title collisions

Confluence page titles are unique per **space**, not per parent. A note is therefore matched across the whole space: if a page with the same title already exists elsewhere, it is updated and moved under the target parent rather than duplicated. The run reports this as `adopted <title> (was under …)`.

This means a generic title like `1` or `2` will attach to whatever unrelated page already holds that title in the space, and overwrite it with the vault content. Publish into a dedicated space, or give notes distinctive names.

A page that fails does not abort the run — the remaining pages are still published, and the final notice lists every failure by name.
