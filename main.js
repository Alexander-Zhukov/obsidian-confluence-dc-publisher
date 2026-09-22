"use strict";

const obsidian = (() => {
  try {
    return require("obsidian");
  } catch (error) {
    return null;
  }
})();

const CALLOUT_MACROS = {
  note: "info",
  info: "info",
  abstract: "info",
  summary: "info",
  question: "info",
  example: "info",
  quote: "info",
  tip: "tip",
  hint: "tip",
  success: "tip",
  check: "tip",
  done: "tip",
  warning: "note",
  caution: "note",
  attention: "note",
  danger: "warning",
  error: "warning",
  failure: "warning",
  fail: "warning",
  bug: "warning",
};
const DEFAULT_CALLOUT_MACRO = "info";
const CHECKED_MARK = "☑";
const UNCHECKED_MARK = "☐";
const INDEX_PREFIX = "_";
const MARKDOWN_SUFFIX = ".md";
const PAGE_LIMIT = 200;
const USER_AGENT = "confluence-dc-publisher";
const PLACEHOLDER_PREFIX = "xobsidianfragment";
const PLACEHOLDER_SUFFIX = "x";

const DEFAULT_SETTINGS = {
  baseUrl: "",
  username: "",
  token: "",
  rootPageId: "",
  publishFolder: "",
};

function escapeXml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeCdata(text) {
  return text.split("]]>").join("]]]]><![CDATA[>");
}

function stripFrontmatter(text) {
  return text.replace(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n/, "");
}

class FragmentStore {
  constructor() {
    this.fragments = [];
  }

  store(html) {
    this.fragments.push(html);
    return `${PLACEHOLDER_PREFIX}${this.fragments.length - 1}${PLACEHOLDER_SUFFIX}`;
  }

  restore(html) {
    let result = html;
    for (let index = 0; index < this.fragments.length; index += 1) {
      result = result.split(`${PLACEHOLDER_PREFIX}${index}${PLACEHOLDER_SUFFIX}`).join(this.fragments[index]);
    }
    return result;
  }
}

class MarkdownConverter {
  constructor(pageTitles) {
    this.pageTitles = pageTitles instanceof Set ? pageTitles : new Set(pageTitles || []);
  }

  convert(source) {
    const context = { attachments: [], store: new FragmentStore() };
    const body = this.renderBlocks(stripFrontmatter(source).split(/\r?\n/), context);
    return { body: context.store.restore(body), attachments: context.attachments };
  }

  renderBlocks(lines, context) {
    const output = [];
    let index = 0;
    while (index < lines.length) {
      const line = lines[index];
      if (line.trim() === "") {
        index += 1;
      } else if (/^\s*```/.test(line)) {
        index = this.readCodeBlock(lines, index, output);
      } else if (/^>\s*\[!/.test(line)) {
        index = this.readCallout(lines, index, output, context);
      } else if (/^>/.test(line)) {
        index = this.readQuote(lines, index, output, context);
      } else if (/^#{1,6}\s+/.test(line)) {
        index = this.readHeading(lines, index, output, context);
      } else if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[index + 1] || "")) {
        index = this.readTable(lines, index, output, context);
      } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
        output.push("<hr />");
        index += 1;
      } else if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
        index = this.readList(lines, index, output, context, 0);
      } else {
        index = this.readParagraph(lines, index, output, context);
      }
    }
    return output.join("");
  }

  readCodeBlock(lines, start, output) {
    const language = (lines[start].trim().replace(/^```/, "").trim().split(/\s+/)[0] || "").trim();
    const collected = [];
    let index = start + 1;
    while (index < lines.length && !/^\s*```/.test(lines[index])) {
      collected.push(lines[index]);
      index += 1;
    }
    const parameter = language
      ? `<ac:parameter ac:name="language">${escapeXml(language)}</ac:parameter>`
      : "";
    output.push(
      `<ac:structured-macro ac:name="code">${parameter}` +
        `<ac:plain-text-body><![CDATA[${escapeCdata(collected.join("\n"))}]]></ac:plain-text-body>` +
        `</ac:structured-macro>`
    );
    return index + 1;
  }

  readCallout(lines, start, output, context) {
    const header = lines[start].match(/^>\s*\[!([A-Za-z]+)\][+-]?\s*(.*)$/);
    const macroName = CALLOUT_MACROS[header[1].toLowerCase()] || DEFAULT_CALLOUT_MACRO;
    const title = (header[2] || "").trim();
    const collected = [];
    let index = start + 1;
    while (index < lines.length && /^>/.test(lines[index])) {
      collected.push(lines[index].replace(/^>\s?/, ""));
      index += 1;
    }
    const titleParameter = title ? `<ac:parameter ac:name="title">${escapeXml(title)}</ac:parameter>` : "";
    output.push(
      `<ac:structured-macro ac:name="${macroName}">${titleParameter}` +
        `<ac:rich-text-body>${this.renderBlocks(collected, context)}</ac:rich-text-body>` +
        `</ac:structured-macro>`
    );
    return index;
  }

  readQuote(lines, start, output, context) {
    const collected = [];
    let index = start;
    while (index < lines.length && /^>/.test(lines[index])) {
      collected.push(lines[index].replace(/^>\s?/, ""));
      index += 1;
    }
    output.push(`<blockquote>${this.renderBlocks(collected, context)}</blockquote>`);
    return index;
  }

  readHeading(lines, start, output, context) {
    const match = lines[start].match(/^(#{1,6})\s+(.*)$/);
    const level = match[1].length;
    output.push(`<h${level}>${this.renderInline(match[2].trim(), context)}</h${level}>`);
    return start + 1;
  }

  readTable(lines, start, output, context) {
    const parseRow = (line) =>
      line
        .trim()
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((cell) => cell.trim());
    const header = parseRow(lines[start]);
    let index = start + 2;
    const rows = [];
    while (index < lines.length && /^\s*\|.*\|\s*$/.test(lines[index])) {
      rows.push(parseRow(lines[index]));
      index += 1;
    }
    const headerHtml = header.map((cell) => `<th>${this.renderInline(cell, context)}</th>`).join("");
    const bodyHtml = rows
      .map((row) => `<tr>${row.map((cell) => `<td>${this.renderInline(cell, context)}</td>`).join("")}</tr>`)
      .join("");
    output.push(`<table><thead><tr>${headerHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>`);
    return index;
  }

  readList(lines, start, output, context, baseIndent) {
    const ordered = /^\s*\d+[.)]\s+/.test(lines[start]);
    const items = [];
    let index = start;
    while (index < lines.length) {
      const line = lines[index];
      if (line.trim() === "") {
        break;
      }
      const match = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
      if (!match) {
        break;
      }
      const indent = match[1].length;
      if (indent < baseIndent) {
        break;
      }
      if (indent > baseIndent) {
        const nested = [];
        index = this.readList(lines, index, nested, context, indent);
        if (items.length > 0) {
          items[items.length - 1] += nested.join("");
        } else {
          items.push(nested.join(""));
        }
        continue;
      }
      const task = match[3].match(/^\[([ xX])\]\s+(.*)$/);
      const content = task
        ? `${task[1].toLowerCase() === "x" ? CHECKED_MARK : UNCHECKED_MARK} ${task[2]}`
        : match[3];
      items.push(this.renderInline(content, context));
      index += 1;
    }
    const tag = ordered ? "ol" : "ul";
    output.push(`<${tag}>${items.map((item) => `<li>${item}</li>`).join("")}</${tag}>`);
    return index;
  }

  readParagraph(lines, start, output, context) {
    const collected = [];
    let index = start;
    while (
      index < lines.length &&
      lines[index].trim() !== "" &&
      !/^\s*```/.test(lines[index]) &&
      !/^>/.test(lines[index]) &&
      !/^#{1,6}\s+/.test(lines[index]) &&
      !/^\s*([-*+]|\d+[.)])\s+/.test(lines[index])
    ) {
      collected.push(lines[index]);
      index += 1;
    }
    const rendered = this.renderInline(collected.join("\n"), context);
    output.push(rendered.trim() === "" ? "" : `<p>${rendered}</p>`);
    return index;
  }

  renderInline(text, context) {
    const store = context.store;
    let result = text;

    result = result.replace(/!\[\[([^\]|]+?)(?:\|(\d+))?\]\]/g, (match, name, width) => {
      const filename = name.trim();
      context.attachments.push(filename);
      const widthAttribute = width ? ` ac:width="${width}"` : "";
      return store.store(
        `<ac:image${widthAttribute}><ri:attachment ri:filename="${escapeXml(filename)}" /></ac:image>`
      );
    });

    result = result.replace(/\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g, (match, target, label) => {
      const title = target.trim().split("/").pop();
      const text_ = (label || title).trim();
      if (!this.pageTitles.has(title)) {
        return text_;
      }
      return store.store(
        `<ac:link><ri:page ri:content-title="${escapeXml(title)}" />` +
          `<ac:plain-text-link-body><![CDATA[${escapeCdata(text_)}]]></ac:plain-text-link-body></ac:link>`
      );
    });

    result = result.replace(/`([^`]+)`/g, (match, code) => store.store(`<code>${escapeXml(code)}</code>`));

    result = result.replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, (match, label, href) =>
      store.store(`<a href="${escapeXml(href)}">${escapeXml(label)}</a>`)
    );

    result = escapeXml(result);
    result = result.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    result = result.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
    result = result.replace(/~~([^~]+)~~/g, "<del>$1</del>");
    result = result.replace(/\n/g, " ");
    return result;
  }
}

class ConfluenceClient {
  constructor(settings) {
    this.baseUrl = settings.baseUrl.replace(/\/+$/, "");
    this.authorization = `Basic ${Buffer.from(`${settings.username}:${settings.token}`).toString("base64")}`;
  }

  async request(method, path, options) {
    const settings = options || {};
    const parameters = Object.assign({ url: `${this.baseUrl}${path}`, method, throw: false }, settings);
    parameters.headers = Object.assign(
      {
        Authorization: this.authorization,
        "X-Atlassian-Token": "no-check",
        "User-Agent": USER_AGENT,
      },
      settings.headers || {}
    );
    const response = await obsidian.requestUrl(parameters);
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`${method} ${path} failed with ${response.status}: ${String(response.text).slice(0, 200)}`);
    }
    return response.json;
  }

  getPage(pageId) {
    return this.request("GET", `/rest/api/content/${pageId}?expand=space,version`);
  }

  async findChild(parentId, title) {
    const result = await this.request(
      "GET",
      `/rest/api/content/${parentId}/child/page?limit=${PAGE_LIMIT}&expand=version`
    );
    return result.results.find((page) => page.title === title) || null;
  }

  async findInSpace(spaceKey, title) {
    const result = await this.request(
      "GET",
      `/rest/api/content?type=page&spaceKey=${encodeURIComponent(spaceKey)}` +
        `&title=${encodeURIComponent(title)}&limit=${PAGE_LIMIT}&expand=version,ancestors`
    );
    return result.results.find((page) => page.title === title) || null;
  }

  createPage(spaceKey, parentId, title, body) {
    return this.request("POST", "/rest/api/content", {
      contentType: "application/json",
      body: JSON.stringify({
        type: "page",
        title,
        space: { key: spaceKey },
        ancestors: [{ id: parentId }],
        body: { storage: { value: body, representation: "storage" } },
      }),
    });
  }

  updatePage(page, spaceKey, body, parentId) {
    const payload = {
      id: page.id,
      type: "page",
      title: page.title,
      space: { key: spaceKey },
      body: { storage: { value: body, representation: "storage" } },
      version: { number: page.version.number + 1 },
    };
    if (parentId) {
      payload.ancestors = [{ id: parentId }];
    }
    return this.request("PUT", `/rest/api/content/${page.id}`, {
      contentType: "application/json",
      body: JSON.stringify(payload),
    });
  }

  async existingAttachments(pageId) {
    const result = await this.request(
      "GET",
      `/rest/api/content/${pageId}/child/attachment?limit=${PAGE_LIMIT}`
    );
    return new Set(result.results.map((item) => item.title));
  }

  uploadAttachment(pageId, fileName, data) {
    const boundary = `----obsidian${Date.now().toString(16)}`;
    const encoder = new TextEncoder();
    const head = encoder.encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
        `Content-Type: application/octet-stream\r\n\r\n`
    );
    const tail = encoder.encode(`\r\n--${boundary}--\r\n`);
    const payload = new Uint8Array(head.length + data.byteLength + tail.length);
    payload.set(head, 0);
    payload.set(new Uint8Array(data), head.length);
    payload.set(tail, head.length + data.byteLength);
    return this.request("POST", `/rest/api/content/${pageId}/child/attachment`, {
      headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
      body: payload.buffer,
    });
  }
}

class VaultPublisher {
  constructor(app, client, converter, spaceKey, report) {
    this.app = app;
    this.client = client;
    this.converter = converter;
    this.spaceKey = spaceKey;
    this.report = report;
    this.failures = [];
  }

  static indexFile(folder) {
    return (
      folder.children.find(
        (child) =>
          child.children === undefined &&
          child.name.startsWith(INDEX_PREFIX) &&
          child.name.toLowerCase().endsWith(MARKDOWN_SUFFIX)
      ) || null
    );
  }

  async publish(folder, pageId) {
    const index = VaultPublisher.indexFile(folder);
    if (index) {
      const document = await this.prepare(index);
      const page = await this.client.getPage(pageId);
      await this.client.updatePage(page, this.spaceKey, document.body);
      this.report(`updated target page from ${index.name}`);
      await this.publishAttachments(pageId, index.parent, document.attachments);
    }
    await this.publishChildren(folder, pageId);
  }

  async publishChildren(folder, pageId) {
    const children = folder.children.slice().sort((a, b) => a.name.localeCompare(b.name));
    for (const child of children) {
      // Одна упавшая страница не должна обрывать весь прогон: записываем сбой,
      // называем виновника и идём дальше — остальные ветки публикуются.
      try {
        if (child.children !== undefined) {
          const index = VaultPublisher.indexFile(child);
          const document = index ? await this.prepare(index) : { body: "", attachments: [] };
          const childId = await this.publishBody(child.name, document.body, pageId);
          await this.publishAttachments(childId, child, document.attachments);
          await this.publishChildren(child, childId);
        } else if (child.name.toLowerCase().endsWith(MARKDOWN_SUFFIX) && !child.name.startsWith(INDEX_PREFIX)) {
          const document = await this.prepare(child);
          const noteId = await this.publishBody(child.basename, document.body, pageId);
          await this.publishAttachments(noteId, child.parent, document.attachments);
        }
      } catch (error) {
        const name = child.children !== undefined ? child.name : child.basename;
        this.failures.push({ name, path: child.path, message: error.message });
        this.report(`FAILED ${name}: ${error.message}`);
      }
    }
  }

  async prepare(file) {
    const source = await this.app.vault.read(file);
    return this.converter.convert(source);
  }

  async publishBody(title, body, parentId) {
    const existing = await this.client.findChild(parentId, title);
    if (existing) {
      await this.client.updatePage(existing, this.spaceKey, body);
      this.report(`updated ${title}`);
      return existing.id;
    }
    // Заголовок уникален в пределах всего спейса, а не внутри родителя: страница
    // с таким именем может лежать в другой ветке. Создавать дубль нельзя — Confluence
    // ответит 400, поэтому находим её по спейсу, обновляем и переносим к нужному родителю.
    const elsewhere = await this.client.findInSpace(this.spaceKey, title);
    if (elsewhere) {
      const where = (elsewhere.ancestors || []).map((item) => item.title).join(" / ") || "root";
      await this.client.updatePage(elsewhere, this.spaceKey, body, parentId);
      this.report(`adopted ${title} (was under ${where})`);
      return elsewhere.id;
    }
    const created = await this.client.createPage(this.spaceKey, parentId, title, body);
    this.report(`created ${title}`);
    return created.id;
  }

  async publishAttachments(pageId, folder, names) {
    const required = Array.from(new Set(names));
    if (required.length === 0) {
      return;
    }
    const present = await this.client.existingAttachments(pageId);
    for (const name of required) {
      if (present.has(name)) {
        continue;
      }
      const file = this.app.metadataCache.getFirstLinkpathDest(name, folder.path);
      if (!file) {
        throw new Error(`attachment not found in vault: ${name}`);
      }
      const data = await this.app.vault.readBinary(file);
      await this.client.uploadAttachment(pageId, name, data);
    }
    this.report(`attachments for page ${pageId}: ${required.length}`);
  }
}

function collectPageTitles(folder) {
  const titles = new Set();
  const walk = (current) => {
    for (const child of current.children) {
      if (child.children !== undefined) {
        walk(child);
      } else if (child.name.toLowerCase().endsWith(MARKDOWN_SUFFIX) && !child.name.startsWith(INDEX_PREFIX)) {
        titles.add(child.basename);
      }
    }
  };
  walk(folder);
  return titles;
}

class ConfluencePublisherSettingTab extends (obsidian ? obsidian.PluginSettingTab : Object) {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    const fields = [
      ["Base URL", "Confluence Data Center root, without /wiki", "baseUrl", "https://confluence.example.com", false],
      ["Username", "Confluence login", "username", "jdoe", false],
      ["API token", "API token, not an account password", "token", "mo-api-...", true],
      ["Root page id", "Target page that receives the folder tree", "rootPageId", "123456789", false],
      ["Vault folder", "Folder to publish, empty means the whole vault", "publishFolder", "Reports", false],
    ];
    for (const [name, description, key, placeholder, secret] of fields) {
      new obsidian.Setting(containerEl)
        .setName(name)
        .setDesc(description)
        .addText((text) => {
          text
            .setPlaceholder(placeholder)
            .setValue(this.plugin.settings[key])
            .onChange(async (value) => {
              this.plugin.settings[key] = value.trim();
              await this.plugin.saveSettings();
            });
          if (secret) {
            text.inputEl.type = "password";
            text.inputEl.autocomplete = "off";
          }
        });
    }
  }
}

class ConfluencePublisherPlugin extends (obsidian ? obsidian.Plugin : Object) {
  async onload() {
    await this.loadSettings();
    this.addSettingTab(new ConfluencePublisherSettingTab(this.app, this));
    this.addCommand({
      id: "publish-to-confluence-dc",
      name: "Publish folder to Confluence",
      callback: () => this.publish(),
    });
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  resolveFolder() {
    if (!this.settings.publishFolder) {
      return this.app.vault.getRoot();
    }
    const folder = this.app.vault.getAbstractFileByPath(this.settings.publishFolder);
    if (!folder || folder.children === undefined) {
      throw new Error(`folder not found: ${this.settings.publishFolder}`);
    }
    return folder;
  }

  async publish() {
    const notice = new obsidian.Notice("Confluence: publishing...", 0);
    try {
      for (const key of ["baseUrl", "username", "token", "rootPageId"]) {
        if (!this.settings[key]) {
          throw new Error(`setting is empty: ${key}`);
        }
      }
      const folder = this.resolveFolder();
      const client = new ConfluenceClient(this.settings);
      const target = await client.getPage(this.settings.rootPageId);
      const converter = new MarkdownConverter(collectPageTitles(folder));
      let count = 0;
      const publisher = new VaultPublisher(this.app, client, converter, target.space.key, (message) => {
        count += 1;
        notice.setMessage(`Confluence: ${message}`);
      });
      await publisher.publish(folder, this.settings.rootPageId);
      notice.hide();
      const failures = publisher.failures;
      if (failures.length === 0) {
        new obsidian.Notice(`Confluence: done, ${count} operations`, 6000);
      } else {
        const listed = failures.map((item) => `${item.name}: ${item.message}`).join("\n");
        console.error("Confluence publish failures:", failures);
        new obsidian.Notice(
          `Confluence: ${count} operations, ${failures.length} failed\n${listed}`,
          20000
        );
      }
    } catch (error) {
      notice.hide();
      new obsidian.Notice(`Confluence: ${error.message}`, 12000);
    }
  }
}

module.exports = ConfluencePublisherPlugin;
module.exports.MarkdownConverter = MarkdownConverter;
module.exports.stripFrontmatter = stripFrontmatter;
