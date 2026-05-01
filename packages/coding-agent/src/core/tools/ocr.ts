/**
 * OCR tools — macOS Vision framework via Swift.
 * Ported from Jarvis (harness) OCR implementation.
 */

import { execSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { Type } from "typebox";
import type { ToolDefinition } from "../extensions/types.js";
import { defineTool } from "../extensions/types.js";

// ── Constants ────────────────────────────────────────────────────────────────

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".heic", ".tif", ".tiff", ".bmp"]);

const IMPORTANT_TEXT_HINTS = [
	"aadhaar",
	"aadhar",
	"voter",
	"election",
	"identity",
	"identification",
	"driving",
	"driver",
	"license",
	"licence",
	"passport",
	"pan",
	"ssn",
	"social security",
	"date of birth",
	"dob",
	"government",
	"address",
	"resume",
	"curriculum vitae",
	"experience",
	"education",
	"skills",
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function isImagePath(p: string): boolean {
	const ext = extname(p).toLowerCase();
	return IMAGE_EXTS.has(ext);
}

function scoreText(text: string, keywords?: string[]): number {
	const haystack = text.toLowerCase();
	const terms = (keywords ?? IMPORTANT_TEXT_HINTS).map((k) => k.toLowerCase());
	let score = 0;
	for (const term of terms) {
		if (haystack.includes(term)) score += 4;
	}
	const commonTokens = ["id", "no", "number", "name"];
	score += Math.min(6, commonTokens.filter((t) => haystack.includes(t)).length);
	return score;
}

// ── OCR execution ────────────────────────────────────────────────────────────

function ocrImage(path: string): string {
	if (!existsSync(path)) return `ERROR: ${path} not found`;
	const stat = statSync(path);
	if (!stat.isFile()) return `ERROR: ${path} is not a file`;

	const swiftCode = `
import Vision
import Foundation

let url = URL(fileURLWithPath: CommandLine.arguments[1])
let request = VNRecognizeTextRequest { req, err in
    guard let obs = req.results as? [VNRecognizedTextObservation] else { return }
    for o in obs {
        if let top = o.topCandidates(1).first {
            print(top.string)
        }
    }
}
request.recognitionLevel = .accurate
let handler = VNImageRequestHandler(url: url, options: [:])
try? handler.perform([request])
`;

	try {
		const output = execSync(`swift -e ${JSON.stringify(swiftCode)} ${JSON.stringify(path)}`, {
			encoding: "utf-8",
			timeout: 30,
			maxBuffer: 1024 * 1024,
		}).trim();

		if (!output) return "No text detected in image.";
		return output;
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		return `ERROR: OCR failed: ${msg}`;
	}
}

// ── Single image OCR tool ────────────────────────────────────────────────────

const readImageTextSchema = Type.Object({
	path: Type.String({ description: "Path to the image file" }),
});

export const readImageTextTool: ToolDefinition<typeof readImageTextSchema> = defineTool({
	name: "read_image_text",
	label: "OCR - Read Image Text",
	description:
		"Extract all text from an image file using macOS Vision framework (on-device OCR). " +
		"Supports PNG, JPG, JPEG, HEIC, TIFF, BMP. Returns extracted text or error message.",
	promptSnippet: "Extract text from a single image using macOS Vision OCR",
	parameters: readImageTextSchema,
	execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
		const text = ocrImage(params.path);
		if (text.startsWith("ERROR:")) {
			throw new Error(text);
		}
		return {
			content: [{ type: "text" as const, text }],
			details: undefined,
		};
	},
});

// ── Batch image OCR tool ─────────────────────────────────────────────────────

const readImagesTextSchema = Type.Object({
	paths: Type.Optional(
		Type.Array(Type.String(), { description: "Explicit image file paths (omit to scan a directory)" }),
	),
	directory: Type.Optional(Type.String({ description: "Directory to scan for images (default: current dir)" })),
	pattern: Type.Optional(Type.String({ description: "Glob pattern (default: **/*)" })),
	maxFiles: Type.Optional(Type.Number({ description: "Max images to process (default 80, max 500)" })),
	maxCharsPerImage: Type.Optional(Type.Number({ description: "Max chars per image preview (default 800)" })),
	includeEmpty: Type.Optional(Type.Boolean({ description: "Include no-text results (default false)" })),
	keywords: Type.Optional(Type.Array(Type.String(), { description: "Keywords to prioritize important results" })),
});

export const readImagesTextTool: ToolDefinition<typeof readImagesTextSchema> = defineTool({
	name: "read_images_text",
	label: "OCR - Batch Read Images Text",
	description:
		"OCR many images concurrently and return compact per-file text previews. " +
		"Use this to scan directories of images for text. Results are sorted by relevance " +
		"when keywords are provided (e.g., passport, license, resume).",
	promptSnippet: "Batch OCR multiple images with relevance ranking",
	parameters: readImagesTextSchema,
	execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
		const maxFiles = Math.min(params.maxFiles ?? 80, 500);
		const maxChars = params.maxCharsPerImage ?? 800;
		const includeEmpty = params.includeEmpty ?? false;
		const keywords = params.keywords;

		let images: string[] = [];

		if (params.paths && params.paths.length > 0) {
			images = params.paths
				.filter((p) => {
					const full = resolve(p);
					return existsSync(full) && statSync(full).isFile() && isImagePath(p);
				})
				.slice(0, maxFiles);
		} else {
			const dir = params.directory ? resolve(params.directory) : process.cwd();
			if (existsSync(dir)) {
				const all = readdirSync(dir, { recursive: true });
				for (const entry of all) {
					if (images.length >= maxFiles) break;
					const fullPath = join(dir, entry.toString());
					if (existsSync(fullPath) && statSync(fullPath).isFile() && isImagePath(entry.toString())) {
						images.push(fullPath);
					}
				}
			}
		}

		if (images.length === 0) {
			return {
				content: [
					{ type: "text" as const, text: "No image files found. Supported: PNG, JPG, JPEG, HEIC, TIFF, BMP." },
				],
				details: undefined,
			};
		}

		const rows: { path: string; text: string; score: number; index: number }[] = [];
		const cwd = process.cwd();

		for (let i = 0; i < images.length; i++) {
			const imgPath = images[i];
			const text = ocrImage(imgPath);
			const clean = text.replace(/\s+/g, " ").trim();

			if (!includeEmpty && (clean === "No text detected in image." || clean.startsWith("ERROR:"))) {
				continue;
			}

			const score = scoreText(clean, keywords);
			const displayPath = relative(cwd, imgPath) || imgPath;
			let preview = clean;
			if (preview.length > maxChars) {
				preview = `${preview.slice(0, maxChars - 20).trimEnd()}...`;
			}
			const label = score > 0 ? "LIKELY IMPORTANT" : "TEXT";
			rows.push({
				path: displayPath,
				text: `FILE: ${displayPath}\n${label}: ${preview}`,
				score,
				index: i,
			});
		}

		rows.sort((a, b) => b.score - a.score || a.index - b.index);
		const important = rows.filter((r) => r.score > 0).length;
		const skipped = images.length - rows.length;

		const header =
			`OCR scanned ${images.length} image(s).` +
			(important > 0 ? ` Prioritized ${important} likely important result(s).` : "") +
			(skipped > 0 ? ` Suppressed ${skipped} empty/no-text result(s).` : "");

		const body =
			rows.length > 0 ? `\n\n${rows.map((r) => r.text).join("\n\n")}` : "\nNo text detected in scanned images.";

		return { content: [{ type: "text" as const, text: header + body }], details: undefined };
	},
});

export const ocrTools: ToolDefinition[] = [readImageTextTool, readImagesTextTool];
