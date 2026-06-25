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

interface ImportProgressEvent {
	state: "running" | "success" | "error";
	title: string;
	detail?: string;
}

type ImportProgressCallback = (event: ImportProgressEvent) => void;

interface RenderedDocument {
	title: string;
	markdown: string;
	imageCount: number;
}

interface ImportResult {
	title: string;
	notePath: string;
	imageCount: number;
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

		this.addRibbonIcon("file-input", "导入飞书文档", () => {
			this.openImportModal();
		});

		this.addCommand({
			id: "import-feishu-doc",
			name: "导入飞书文档",
			callback: () => this.openImportModal(),
		});

		this.addCommand({
			id: "refresh-current-feishu-doc",
			name: "刷新当前飞书文档",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) return false;

				const source = this.getFeishuSource(file);
				if (!source) return false;

				if (!checking) {
					void this.refreshDocument(file, source);
				}
				return true;
			},
		});

		this.registerEvent(this.app.workspace.on("file-menu", (menu, file) => {
			if (!(file instanceof TFile)) return;

			const source = this.getFeishuSource(file);
			if (!source) return;

			menu.addItem((item) => {
				item
					.setTitle("刷新飞书文档")
					.setIcon("refresh-cw")
					.onClick(() => {
						void this.refreshDocument(file, source);
					});
			});
		}));

		this.addSettingTab(new FeishuImporterSettingTab(this.app, this));
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private openImportModal() {
		if (Platform.isMobile) {
			new Notice("飞书文档到 Obsidian 需要桌面端 Obsidian，因为它会调用 lark-cli。");
			return;
		}
		new ImportModal(this.app, async (url, progress) => this.importDocument(url, progress)).open();
	}

	private getFeishuSource(file: TFile): string | null {
		const cache = this.app.metadataCache.getFileCache(file);
		const source = cache?.frontmatter?.feishu_source;
		return typeof source === "string" && source.trim() ? source : null;
	}

	private async importDocument(url: string, progress?: ImportProgressCallback): Promise<ImportResult> {
		const trimmedUrl = url.trim();
		if (!trimmedUrl) {
			throw new Error("请先粘贴飞书文档链接。");
		}

		try {
			progress?.({
				state: "running",
				title: "准备导入",
				detail: "正在检查链接并启动导入流程。",
			});
			const imported = await this.fetchAndRender(trimmedUrl, progress);
			const notePath = await this.createNotePath(imported.title);

			progress?.({
				state: "running",
				title: "写入笔记",
				detail: `正在保存到 ${notePath}`,
			});
			await this.ensureFolder(this.parentFolder(notePath));
			const file = await this.writeNote(notePath, imported.markdown);

			progress?.({
				state: "running",
				title: "打开笔记",
				detail: "正在 Obsidian 中打开导入结果。",
			});
			await this.app.workspace.getLeaf(false).openFile(file);

			progress?.({
				state: "success",
				title: "导入完成",
				detail: `已创建并打开 ${notePath}，图片 ${imported.imageCount} 张。`,
			});
			new Notice(`已导入：${imported.title}`);
			return { title: imported.title, notePath, imageCount: imported.imageCount };
		} catch (error) {
			progress?.({
				state: "error",
				title: "导入失败",
				detail: messageOf(error),
			});
			new Notice(`飞书导入失败：${messageOf(error)}`);
			console.error(error);
			throw error;
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

	private async fetchAndRender(url: string, progress?: ImportProgressCallback): Promise<RenderedDocument> {
		progress?.({
			state: "running",
			title: "获取文档",
			detail: "正在调用 lark-cli 读取飞书文档 JSON。",
		});
		const payload = await this.fetchDocument(url);

		progress?.({
			state: "running",
			title: "解析文档",
			detail: "已拿到飞书返回内容，正在转换为 Obsidian Markdown。",
		});
		const document = payload.data?.document;
		const rawContent = document?.content;
		if (!rawContent) {
			throw new Error("lark-cli returned no document content.");
		}

		const title = extractTitle(rawContent) || document.document_id || "飞书文档";
		const assets = collectImages(rawContent, this.settings.attachmentFolder);
		progress?.({
			state: "running",
			title: "处理图片",
			detail: assets.length > 0
				? `发现 ${assets.length} 张图片，正在下载到 ${normalizeFolder(this.settings.attachmentFolder) || DEFAULT_SETTINGS.attachmentFolder}。`
				: "没有发现需要下载的图片。",
		});
		await this.ensureFolder(this.settings.attachmentFolder);
		await this.downloadImages(assets, progress);

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
			imageCount: assets.length,
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

	private async downloadImages(assets: ImageAsset[], progress?: ImportProgressCallback) {
		const vaultBasePath = this.getVaultBasePath();
		let handled = 0;

		for (const asset of assets) {
			if (!asset.token) {
				handled += 1;
				progress?.({
					state: "running",
					title: "处理图片",
					detail: `${handled}/${assets.length} 缺少图片 token，已跳过 ${asset.name}`,
				});
				continue;
			}

			if (!this.settings.overwriteExisting && await this.app.vault.adapter.exists(asset.vaultPath)) {
				handled += 1;
				progress?.({
					state: "running",
					title: "处理图片",
					detail: `${handled}/${assets.length} 已存在，跳过 ${asset.name}`,
				});
				continue;
			}

			progress?.({
				state: "running",
				title: "下载图片",
				detail: `正在下载 ${handled + 1}/${assets.length}：${asset.name}`,
			});
			const outputPath = `${vaultBasePath}/${asset.vaultPath}`;
			await this.runLarkCli([
				"docs",
				"+media-preview",
				"--token",
				asset.token,
				"--output",
				outputPath,
			]);
			handled += 1;
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

	private async writeNote(notePath: string, markdown: string): Promise<TFile> {
		const existing = this.app.vault.getAbstractFileByPath(notePath);
		if (existing instanceof TFile) {
			await this.app.vault.modify(existing, markdown);
			return existing;
		}
		if (existing) {
			throw new Error(`${notePath} 已存在，但它不是一个 Markdown 文件。`);
		}
		return await this.app.vault.create(notePath, markdown);
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
	private inputEl!: HTMLInputElement;
	private submitButtonEl!: HTMLButtonElement;
	private closeButtonEl!: HTMLButtonElement;
	private statusPanelEl!: HTMLElement;
	private statusTitleEl!: HTMLElement;
	private statusDetailEl!: HTMLElement;
	private statusLogEl!: HTMLElement;
	private progressBarEl!: HTMLElement;
	private running = false;

	constructor(app: App, private readonly onSubmit: (url: string, progress: ImportProgressCallback) => Promise<ImportResult>) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("feishu-importer-modal");
		contentEl.createEl("h2", { text: "导入飞书文档" });

		const formEl = contentEl.createDiv({ cls: "feishu-importer-form" });
		formEl.createEl("label", {
			cls: "feishu-importer-label",
			text: "飞书文档链接",
		});

		const rowEl = formEl.createDiv({ cls: "feishu-importer-url-row" });
		this.inputEl = rowEl.createEl("input", { cls: "feishu-importer-url-input" });
		this.inputEl.type = "text";
		this.inputEl.placeholder = "https://example.feishu.cn/docx/...";
		this.inputEl.value = this.url;
		this.inputEl.addEventListener("input", () => {
			this.url = this.inputEl.value;
		});
		this.inputEl.addEventListener("keydown", (event) => {
			if (event.key === "Enter" && !event.isComposing) {
				void this.submit();
			}
		});

		const actionsEl = rowEl.createDiv({ cls: "feishu-importer-actions" });
		this.submitButtonEl = actionsEl.createEl("button", {
			cls: "mod-cta",
			text: "导入",
		});
		this.submitButtonEl.addEventListener("click", () => void this.submit());

		this.closeButtonEl = actionsEl.createEl("button", { text: "关闭" });
		this.closeButtonEl.addEventListener("click", () => this.close());

		formEl.createDiv({
			cls: "feishu-importer-help",
			text: "支持飞书 docx/wiki 链接。导入过程中会调用本机 lark-cli，请保持登录状态。",
		});

		this.statusPanelEl = contentEl.createDiv({ cls: "feishu-importer-status-panel feishu-importer-status-idle" });
		this.progressBarEl = this.statusPanelEl.createDiv({ cls: "feishu-importer-progress-bar" });
		this.statusTitleEl = this.statusPanelEl.createDiv({
			cls: "feishu-importer-status-title",
			text: "等待导入",
		});
		this.statusDetailEl = this.statusPanelEl.createDiv({
			cls: "feishu-importer-status-detail",
			text: "粘贴链接后点击导入，完成或失败都会保留在这里。",
		});
		this.statusLogEl = this.statusPanelEl.createDiv({ cls: "feishu-importer-log" });

		this.inputEl.focus();
	}

	private async submit() {
		if (this.running) return;

		const url = this.url.trim();
		if (!url) {
			this.showProgress({
				state: "error",
				title: "缺少链接",
				detail: "请先粘贴飞书 docx 或 wiki 链接。",
			});
			return;
		}

		this.statusLogEl.empty();
		this.setRunning(true);
		let success = false;
		try {
			await this.onSubmit(url, (event) => this.showProgress(event));
			success = true;
		} catch {
			success = false;
		} finally {
			this.setRunning(false);
			this.submitButtonEl.setText(success ? "再次导入" : "重试");
			this.closeButtonEl.setText(success ? "完成" : "关闭");
		}
	}

	private setRunning(running: boolean) {
		this.running = running;
		this.inputEl.disabled = running;
		this.submitButtonEl.disabled = running;
		this.closeButtonEl.disabled = running;
		this.submitButtonEl.setText(running ? "导入中..." : "导入");
	}

	private showProgress(event: ImportProgressEvent) {
		this.statusPanelEl.removeClass("feishu-importer-status-idle");
		this.statusPanelEl.removeClass("feishu-importer-status-running");
		this.statusPanelEl.removeClass("feishu-importer-status-success");
		this.statusPanelEl.removeClass("feishu-importer-status-error");
		this.statusPanelEl.addClass(`feishu-importer-status-${event.state}`);
		this.statusTitleEl.setText(event.title);
		this.statusDetailEl.setText(event.detail ?? "");

		const logRow = this.statusLogEl.createDiv({
			cls: `feishu-importer-log-row feishu-importer-log-${event.state}`,
			text: event.detail ? `${event.title}：${event.detail}` : event.title,
		});
		logRow.setAttr("title", logRow.getText());
		while (this.statusLogEl.children.length > 7) {
			this.statusLogEl.firstElementChild?.remove();
		}
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
