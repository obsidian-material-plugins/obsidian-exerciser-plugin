import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { App, normalizePath } from 'obsidian';
import { minimatch } from 'minimatch';
import { MANIFEST_FILE } from './config';
import { exerciseRootPath, loadManifest } from './vault-service';
import type { ExerciseAnnotation } from './types';

const execute = promisify(execFile);

export const destinationMarker = (app: App) =>
	normalizePath(`${app.vault.configDir}/exerciser-copy-destination.json`);
export const destinationIgnoreRule = (app: App) => `/${destinationMarker(app)}`;

declare global {
	interface Window {
		require?: (name: string) => unknown;
	}
}

const matches = (relative: string, patterns: string[]) =>
	patterns.some((pattern) => minimatch(relative, pattern, { dot: true }));

export const addDestinationIgnoreRule = async (app: App) => {
	const ignoreRule = destinationIgnoreRule(app);
	let source = '';
	try {
		source = await app.vault.adapter.read('.gitignore');
	} catch {
		// A new root .gitignore is valid.
	}
	if (source.split(/\r?\n/).some((line) => line.trim() === ignoreRule)) return false;
	const separator = source.length > 0 && !source.endsWith('\n') ? '\n' : '';
	await app.vault.adapter.write('.gitignore', `${source}${separator}${ignoreRule}\n`);
	return true;
};

export const readDestination = async (app: App): Promise<string | null> => {
	try {
		const parsed = JSON.parse(await app.vault.adapter.read(destinationMarker(app))) as {
			destination?: unknown;
		};
		return typeof parsed.destination === 'string' && path.isAbsolute(parsed.destination)
			? parsed.destination
			: null;
	} catch {
		return null;
	}
};

export const writeDestination = async (app: App, destination: string) => {
	if (!path.isAbsolute(destination)) throw new Error('Choose an absolute destination path.');
	if (!(await app.vault.adapter.exists(app.vault.configDir))) {
		await app.vault.adapter.mkdir(app.vault.configDir);
	}
	await app.vault.adapter.write(
		destinationMarker(app),
		`${JSON.stringify({ destination }, null, 2)}\n`,
	);
};

const injected = (source: Uint8Array, relative: string, annotations: ExerciseAnnotation[]) => {
	const relevant = annotations
		.filter((item) => item.source === relative && item['inject-into-export'])
		.sort((left, right) => right.line - left.line);
	if (!relevant.length) return source;
	const marker = ['.py', '.rb', '.sh', '.yaml', '.yml'].includes(path.extname(relative))
		? '#'
		: '//';
	const lines = new TextDecoder().decode(source).split(/\r?\n/);
	for (const annotation of relevant) {
		lines.splice(Math.min(Math.max(annotation.line - 1, 0), lines.length), 0, `${marker} ${annotation.text}`);
	}
	return new TextEncoder().encode(lines.join('\n'));
};

export const copyExercise = async (app: App, name: string, destination: string) => {
	if (!path.isAbsolute(destination)) throw new Error('Choose an absolute destination path.');
	const root = exerciseRootPath(name);
	if (!root) throw new Error('Invalid exercise path.');
	const manifest = await loadManifest(app, root);
	const target = path.join(destination, name);
	try {
		await fs.access(target);
		throw new Error(`${target} already exists.`);
	} catch (error) {
		if (error instanceof Error && error.message.endsWith('already exists.')) throw error;
	}
	const copied: string[] = [];
	for (const file of app.vault.getFiles()) {
		if (!file.path.startsWith(`${root}/`)) continue;
		const relative = file.path.slice(root.length + 1);
		if (
			relative === MANIFEST_FILE ||
			matches(relative, manifest.files['exclude-from-quartz'])
		)
			continue;
		const output = path.join(target, ...relative.split('/'));
		await fs.mkdir(path.dirname(output), { recursive: true });
		const bytes = new Uint8Array(await app.vault.readBinary(file));
		await fs.writeFile(output, injected(bytes, relative, manifest.annotations));
		copied.push(relative);
	}
	return { target, copied };
};

const findExecutable = async (names: string[]) => {
	for (const name of names) {
		try {
			await execute(process.platform === 'win32' ? 'where.exe' : 'which', [name], {
				windowsHide: true,
			});
			return name;
		} catch {
			// Try the next supported launcher.
		}
	}
	return null;
};

export const suggestedLauncher = async (copied: string[]) => {
	const hasJava = copied.some((file) => file.toLowerCase().endsWith('.java'));
	const hasPython = copied.some((file) => file.toLowerCase().endsWith('.py'));
	if (hasPython && !hasJava) {
		const command = await findExecutable(['code']);
		return command ? { command, label: 'Open in VS Code' } : null;
	}
	if (hasJava && !hasPython) {
		const command = await findExecutable(process.platform === 'win32' ? ['idea64.exe', 'idea.exe'] : ['idea']);
		return command ? { command, label: 'Open in IDEA' } : null;
	}
	return null;
};

export const launchEditor = (command: string, target: string) => {
	const child = spawn(command, ['.'], { cwd: target, detached: true, stdio: 'ignore', windowsHide: true });
	child.unref();
};

export const openDirectory = async (target: string) => {
	const electron = window.require?.('electron') as { shell?: { openPath(path: string): Promise<string> } } | undefined;
	if (!electron?.shell) throw new Error('Operating-system folder opening is unavailable.');
	const error = await electron.shell.openPath(target);
	if (error) throw new Error(error);
};

interface RemoteDialogApi {
	dialog?: {
		showOpenDialog(options: object): Promise<{ canceled: boolean; filePaths: string[] }>;
	};
}

export const chooseDirectory = async (): Promise<string | null> => {
	const electron = window.require?.('electron') as {
		remote?: RemoteDialogApi;
	} | undefined;
	const remote = electron?.remote ??
		(window.require?.('@electron/remote') as RemoteDialogApi | undefined);
	const result = await remote?.dialog?.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
	return result && !result.canceled ? result.filePaths[0] ?? null : null;
};

export const chooseFiles = async (): Promise<string[]> => {
	const electron = window.require?.('electron') as {
		remote?: RemoteDialogApi;
	} | undefined;
	const remote = electron?.remote ??
		(window.require?.('@electron/remote') as RemoteDialogApi | undefined);
	const result = await remote?.dialog?.showOpenDialog({ properties: ['openFile', 'multiSelections'] });
	return result && !result.canceled ? result.filePaths : [];
};
