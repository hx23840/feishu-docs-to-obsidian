import {
	App,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	normalizePath,
	Platform,
} from "obsidian";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

interface FeishuImporterSettings {
	larkCliPath: string;
	noteFolder: string;
	attachmentFolder: string;
	imageLinkStyle: "wikilink" | "markdown";
	overwriteExisting: boolean;
}

interface FeishuDocumentPayload {
	ok: boolean;
	identity?: string;
	data?: {
		document?: {
			content?: string;
			document_id?: string;
			revision_id?: number;
		};
	};
	error?: {
		message?: string;
		code?: number;
		hint?: string;
	};
}

interface ImageAsset {
	index: number;
	token: string;
	name: string;
	alt: string;
	mime: string;
	vaultPath: string;
}

const DEFAULT_SETTINGS: FeishuImporterSettings = {
	larkCliPath: "lark-cli",
	noteFolder: "",
	attachmentFolder: "Feishu Assets",
	imageLinkStyle: "wikilink",
	overwriteExisting: false,
};

export default class FeishuImporterPlugin extends Plugin {
	settings: FeishuImporterSettings;

	async onload() {
		await this.loadSettings();

		this.addCommand({
			id: "import-feishu-doc",
			name: "导入飞书文档",
			callback: () => {
				if (Platform.isMobile) {
					new Notice("飞书文档到 Obsidian 需要桌面端 Obsidian，因为它会调用 lark-cli。");
					return;
				}
				new ImportModal(this.app, async (url) => this.importDocument(url)).open();
			},
		});

		this.addCommand({
			id: "refresh-current-feishu-doc",
			name: "刷新当前飞书文档",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) return false;

				const cache = this.app.metadataCache.getFileCache(file);
				const source = cache?.frontmatter?.feishu_source;
				if (!source) return false;

				if (!checking) {
					void this.refreshDocument(file, source);
				}
				return true;
			},
		});

		this.addSettingTab(new FeishuImporterSettingTab(this.app, this));
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private async importDocument(url: string) {
		const trimmedUrl = url.trim();
		if (!trimmedUrl) {
			new Notice("Feishu document URL is required.");
			return;
		}

		try {
			new Notice("正在导入飞书文档...");
			const imported = await this.fetchAndRender(trimmedUrl);
			const notePath = await this.createNotePath(imported.title);
			await this.ensureFolder(this.parentFolder(notePath));
			await this.app.vault.create(notePath, imported.markdown);
			const file = this.app.vault.getAbstractFileByPath(notePath);
			if (file instanceof TFile) {
				await this.app.workspace.getLeaf(false).openFile(file);
			}
			new Notice(`Imported ${imported.title}`);
		} catch (error) {
			new Notice(`Feishu import failed: ${messageOf(error)}`);
			console.error(error);
		}
	}

	private async refreshDocument(file: TFile, sourceUrl: string) {
		try {
			new Notice("正在刷新飞书文档...");
			const imported = await this.fetchAndRender(sourceUrl);
			await this.app.vault.modify(file, imported.markdown);
			new Notice(`Refreshed ${file.basename}`);
		} catch (error) {
			new Notice(`Feishu refresh failed: ${messageOf(error)}`);
			console.error(error);
		}
	}

	private async fetchAndRender(url: string): Promise<{ title: string; markdown: string }> {
		const payload = await this.fetchDocument(url);
		const document = payload.data?.document;
		const rawContent = document?.content;
		if (!rawContent) {
			throw new Error("lark-cli returned no document content.");
		}

		const title = extractTitle(rawContent) || document.document_id || "飞书文档";
		const assets = collectImages(rawContent, this.settings.attachmentFolder);
		await this.ensureFolder(this.settings.attachmentFolder);
		await this.downloadImages(assets);

		const body = convertFeishuHtmlToMarkdown(rawContent, assets, this.settings.imageLinkStyle);
		const frontmatter = [
			"---",
			`feishu_source: ${JSON.stringify(url)}`,
			`feishu_document_id: ${JSON.stringify(document.document_id ?? "")}`,
			`feishu_revision_id: ${document.revision_id ?? ""}`,
			`feishu_imported_at: ${JSON.stringify(new Date().toISOString())}`,
			"---",
			"",
		].join("\n");

		return {
			title,
			markdown: frontmatter + body,
		};
	}

	private async fetchDocument(url: string): Promise<FeishuDocumentPayload> {
		const { stdout } = await this.runLarkCli([
			"docs",
			"+fetch",
			"--doc",
			url,
			"--format",
			"json",
		]);

		let payload: FeishuDocumentPayload;
		try {
			payload = JSON.parse(stdout);
		} catch {
			throw new Error(`Could not parse lark-cli JSON output: ${stdout.slice(0, 240)}`);
		}

		if (!payload.ok) {
			const message = payload.error?.message || "lark-cli returned an error.";
			const hint = payload.error?.hint ? ` ${payload.error.hint}` : "";
			throw new Error(`${message}${hint}`);
		}

		return payload;
	}

	private async downloadImages(assets: ImageAsset[]) {
		const vaultBasePath = this.getVaultBasePath();

		for (const asset of assets) {
			if (!asset.token) continue;

			if (!this.settings.overwriteExisting && await this.app.vault.adapter.exists(asset.vaultPath)) {
				continue;
			}

			const outputPath = `${vaultBasePath}/${asset.vaultPath}`;
			await this.runLarkCli([
				"docs",
				"+media-preview",
				"--token",
				asset.token,
				"--output",
				outputPath,
			]);
		}
	}

	private async runLarkCli(args: string[]) {
		const env = {
			...process.env,
			PATH: [
				process.env.PATH,
				"/opt/homebrew/bin",
				"/usr/local/bin",
				"/usr/bin",
				"/bin",
				`${process.env.HOME ?? ""}/n/bin`,
			].filter(Boolean).join(":"),
		};

		try {
			return await execFileAsync(this.settings.larkCliPath, args, {
				env,
				maxBuffer: 50 * 1024 * 1024,
				timeout: 120_000,
			});
		} catch (error) {
			const anyError = error as { stderr?: string; stdout?: string; message?: string };
			const detail = anyError.stderr || anyError.stdout || anyError.message || "Unknown lark-cli error.";
			throw new Error(detail.trim());
		}
	}

	private async createNotePath(title: string) {
		const safeTitle = sanitizeFileName(title) || "飞书文档";
		const folder = normalizeFolder(this.settings.noteFolder);
		const basePath = normalizePath(folder ? `${folder}/${safeTitle}.md` : `${safeTitle}.md`);

		if (this.settings.overwriteExisting || !await this.app.vault.adapter.exists(basePath)) {
			return basePath;
		}

		for (let i = 2; i < 1000; i++) {
			const candidate = normalizePath(folder ? `${folder}/${safeTitle} ${i}.md` : `${safeTitle} ${i}.md`);
			if (!await this.app.vault.adapter.exists(candidate)) {
				return candidate;
			}
		}

		throw new Error("Could not create a unique note path.");
	}

	private async ensureFolder(folder: string) {
		const normalized = normalizeFolder(folder);
		if (!normalized) return;

		const parts = normalized.split("/");
		let current = "";
		for (const part of parts) {
			current = current ? `${current}/${part}` : part;
			if (!await this.app.vault.adapter.exists(current)) {
				await this.app.vault.createFolder(current);
			}
		}
	}

	private parentFolder(path: string) {
		const index = path.lastIndexOf("/");
		return index === -1 ? "" : path.slice(0, index);
	}

	private getVaultBasePath(): string {
		const adapter = this.app.vault.adapter as unknown as { basePath?: string; getBasePath?: () => string };
		const basePath = adapter.getBasePath?.() || adapter.basePath;
		if (!basePath) {
			throw new Error("Could not resolve vault path. This plugin only works on desktop.");
		}
		return basePath;
	}
}

class ImportModal extends Modal {
	private url = "";

	constructor(app: App, private readonly onSubmit: (url: string) => Promise<void>) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: "导入飞书文档" });

		new Setting(contentEl)
			.setName("Document URL")
			.setDesc("粘贴飞书 docx 或 wiki 链接。")
			.addText((text) => {
				text.setPlaceholder("https://example.feishu.cn/docx/...")
					.onChange((value) => {
						this.url = value;
					});
				text.inputEl.addEventListener("keydown", (event) => {
					if (event.key === "Enter") {
						void this.submit();
					}
				});
			});

		new Setting(contentEl)
			.addButton((button) => button
				.setButtonText("Import")
				.setCta()
				.onClick(() => void this.submit()))
			.addButton((button) => button
				.setButtonText("Cancel")
				.onClick(() => this.close()));
	}

	private async submit() {
		const url = this.url.trim();
		if (!url) {
			new Notice("Document URL is required.");
			return;
		}
		this.close();
		await this.onSubmit(url);
	}

	onClose() {
		this.contentEl.empty();
	}
}

class FeishuImporterSettingTab extends PluginSettingTab {
	constructor(app: App, private readonly plugin: FeishuImporterPlugin) {
		super(app, plugin);
	}

	display() {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl("h2", { text: "飞书文档到 Obsidian" });

		new Setting(containerEl)
			.setName("lark-cli path")
			.setDesc("Use an absolute path if Obsidian cannot find lark-cli from PATH.")
			.addText((text) => text
				.setPlaceholder("lark-cli")
				.setValue(this.plugin.settings.larkCliPath)
				.onChange(async (value) => {
					this.plugin.settings.larkCliPath = value.trim() || DEFAULT_SETTINGS.larkCliPath;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Note folder")
			.setDesc("Folder where imported notes are created. Leave empty for vault root.")
			.addText((text) => text
				.setPlaceholder("Imported/Feishu")
				.setValue(this.plugin.settings.noteFolder)
				.onChange(async (value) => {
					this.plugin.settings.noteFolder = normalizeFolder(value);
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Attachment folder")
			.setDesc("Images are downloaded here inside the vault.")
			.addText((text) => text
				.setPlaceholder("Feishu Assets")
				.setValue(this.plugin.settings.attachmentFolder)
				.onChange(async (value) => {
					this.plugin.settings.attachmentFolder = normalizeFolder(value) || DEFAULT_SETTINGS.attachmentFolder;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Image link style")
			.setDesc("Wiki links render reliably in Obsidian. Markdown links are more portable.")
			.addDropdown((dropdown) => dropdown
				.addOption("wikilink", "Obsidian wiki links")
				.addOption("markdown", "Markdown links")
				.setValue(this.plugin.settings.imageLinkStyle)
				.onChange(async (value: "wikilink" | "markdown") => {
					this.plugin.settings.imageLinkStyle = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Overwrite existing files")
			.setDesc("Replace existing imported notes and image files when paths match.")
			.addToggle((toggle) => toggle
				.setValue(this.plugin.settings.overwriteExisting)
				.onChange(async (value) => {
					this.plugin.settings.overwriteExisting = value;
					await this.plugin.saveSettings();
				}));
	}
}

function collectImages(rawContent: string, attachmentFolder: string): ImageAsset[] {
	const folder = normalizeFolder(attachmentFolder) || DEFAULT_SETTINGS.attachmentFolder;
	const seen = new Map<string, number>();

	return [...rawContent.matchAll(/<img\b[^>]*\/?>/g)].map((match, index) => {
		const tag = match[0];
		const token = attr(tag, "src");
		const rawName = attr(tag, "name") || `image-${index + 1}.png`;
		const safeName = uniqueName(sanitizeFileName(rawName), seen);
		return {
			index: index + 1,
			token,
			name: safeName,
			alt: decodeEntities(attr(tag, "alt") || rawName || "image"),
			mime: attr(tag, "mime"),
			vaultPath: normalizePath(`${folder}/${safeName}`),
		};
	});
}

function convertFeishuHtmlToMarkdown(
	rawContent: string,
	assets: ImageAsset[],
	imageLinkStyle: "wikilink" | "markdown",
): string {
	const byToken = new Map(assets.map((asset) => [asset.token, asset]));

	function convertBasic(input: string): string {
		let html = input;
		html = html.replace(/<img\b[^>]*\/?>/g, (tag) => {
			const token = attr(tag, "src");
			const asset = byToken.get(token);
			if (!asset) return "";
			const link = imageLinkStyle === "wikilink"
				? `![[${asset.vaultPath}]]`
				: `![${escapeMarkdownAlt(asset.alt)}](${encodeURI(asset.vaultPath)})`;
			return `\n\n${link}\n\n`;
		});
		html = html.replace(/<title>([\s\S]*?)<\/title>/g, "\n# $1\n");
		html = html.replace(/<h1>([\s\S]*?)<\/h1>/g, "\n# $1\n");
		html = html.replace(/<h2>([\s\S]*?)<\/h2>/g, "\n## $1\n");
		html = html.replace(/<h3>([\s\S]*?)<\/h3>/g, "\n### $1\n");
		html = html.replace(/<h4>([\s\S]*?)<\/h4>/g, "\n#### $1\n");
		html = html.replace(/<hr\s*\/?>/g, "\n\n---\n\n");
		html = html.replace(/<b>/g, "**").replace(/<\/b>/g, "**");
		html = html.replace(/<strong>/g, "**").replace(/<\/strong>/g, "**");
		html = html.replace(/<i>/g, "*").replace(/<\/i>/g, "*");
		html = html.replace(/<em>/g, "*").replace(/<\/em>/g, "*");
		html = html.replace(/<ul>/g, "\n").replace(/<\/ul>/g, "\n");
		html = html.replace(/<ol>/g, "\n").replace(/<\/ol>/g, "\n");
		html = html.replace(/<li>/g, "\n- ").replace(/<\/li>/g, "\n");
		html = html.replace(/<p>/g, "\n\n").replace(/<\/p>/g, "\n");
		html = html.replace(/<br\s*\/?>/g, "\n");
		html = html.replace(/<[^>]+>/g, "");
		return normalizeMarkdown(html);
	}

	let html = rawContent;
	html = html.replace(/<callout\b([^>]*)>([\s\S]*?)<\/callout>/g, (match, _attrs, body) => {
		const emoji = attr(match, "emoji");
		const inner = convertBasic(body).trim();
		const title = emoji ? ` ${emoji}` : "";
		const lines = [`> [!note]${title}`];
		if (inner) {
			lines.push(...inner.split("\n").map((line) => line.trim() ? `> ${line}` : ">"));
		}
		return `\n\n${lines.join("\n")}\n\n`;
	});

	return convertBasic(html);
}

function extractTitle(rawContent: string): string {
	const title = rawContent.match(/<title>([\s\S]*?)<\/title>/)?.[1];
	return title ? decodeEntities(stripTags(title)).trim() : "";
}

function normalizeMarkdown(markdown: string): string {
	return decodeEntities(markdown)
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.replace(/\n(- .+)\n\n(?=- )/g, "\n$1\n")
		.trim() + "\n";
}

function attr(tag: string, name: string): string {
	const match = tag.match(new RegExp(`${name}="([^"]*)"`));
	return match ? match[1] : "";
}

function decodeEntities(value: string): string {
	return value
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, "\"")
		.replace(/&#39;/g, "'")
		.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
		.replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)));
}

function stripTags(value: string): string {
	return value.replace(/<[^>]+>/g, "");
}

function sanitizeFileName(value: string): string {
	return value
		.replace(/[\\/:*?"<>|#\^\[\]]/g, "_")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 160);
}

function uniqueName(name: string, seen: Map<string, number>): string {
	const safeName = name || "image.png";
	const count = seen.get(safeName) ?? 0;
	seen.set(safeName, count + 1);

	if (count === 0) return safeName;

	const dot = safeName.lastIndexOf(".");
	if (dot === -1) return `${safeName}-${count + 1}`;
	return `${safeName.slice(0, dot)}-${count + 1}${safeName.slice(dot)}`;
}

function normalizeFolder(value: string): string {
	return normalizePath(value.trim().replace(/^\/+|\/+$/g, ""));
}

function escapeMarkdownAlt(value: string): string {
	return value.replace(/[\]\n\r]/g, " ");
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
