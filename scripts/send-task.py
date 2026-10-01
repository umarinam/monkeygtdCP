#!/usr/bin/env python3
"""Queue a MonkeyGTD task in the sync inbox (GitHub Gist or GitHub repo).

The app imports queued tasks on its next sync (js/infra/gist-sync.js and
js/infra/repo-sync.js), the same way it imports tasks sent from Inbox.html.

Usage:
  python send-task.py <ParentTaskId> <Task text...>      add as a child of a task
  python send-task.py --inbox <Task text...>             add to the list named "Inbox"
  python send-task.py --list-id <ListId> <Task text...>  add to a specific list

ParentTaskId may also be a permalink (#task-<id> or a full URL ending in it).

Options:
  --due YYYY-MM-DD | --asap   set a due date, or mark the task ASAP
  --provider gist|repo        inbox backend (default: $MGTD_SYNC_PROVIDER, else gist)
  --dry-run                   print the queued line without sending it

Environment variables:
  Gist: MGTD_GIST_ID, MGTD_GIST_TOKEN
  Repo: MGTD_REPO_TOKEN, MGTD_REPO_OWNER, MGTD_REPO_NAME,
        MGTD_REPO_BRANCH      (default: main)
        MGTD_REPO_PATH        (backup file; default: monkeygtd-backup.json)
        MGTD_REPO_INBOX_PATH  (default: monkeygtd-inbox.ndjson next to the backup file)
"""

from __future__ import annotations

import argparse
import base64
import datetime as dt
import json
import os
import re
import sys
import uuid
from typing import Any, Dict
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

DEFAULT_INBOX_FILE = "monkeygtd-inbox.ndjson"
DEFAULT_REPO_PATH = "monkeygtd-backup.json"
# Overridable so tests can point the script at a local stub server.
GITHUB_API_URL = (os.getenv("MGTD_GITHUB_API_URL", "") or "https://api.github.com").rstrip("/")


class UsageError(Exception):
	pass


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
	parser = argparse.ArgumentParser(
		description="Queue a task in the MonkeyGTD sync inbox (GitHub Gist or repo)",
		epilog="Examples:\n"
		"  send-task.py abc123 Buy milk\n"
		"  send-task.py --inbox Call the dentist --due 2026-10-05\n"
		"  send-task.py --list-id l42 --provider repo Renew passport --asap",
		formatter_class=argparse.RawDescriptionHelpFormatter,
	)
	parser.add_argument(
		"words",
		nargs="+",
		metavar="WORD",
		help="ParentTaskId followed by the task text (only the task text with --inbox/--list-id)",
	)

	target = parser.add_mutually_exclusive_group()
	target.add_argument("--inbox", action="store_true", help='Add to the list named "Inbox" instead of under a parent task')
	target.add_argument("--list-id", default="", help="Add to this list instead of under a parent task")

	due = parser.add_mutually_exclusive_group()
	due.add_argument("--due", default="", help="Due date, YYYY-MM-DD")
	due.add_argument("--asap", action="store_true", help="Mark the task ASAP")

	parser.add_argument(
		"--provider",
		default=os.getenv("MGTD_SYNC_PROVIDER", "") or "gist",
		help="Inbox backend: gist or repo (default: $MGTD_SYNC_PROVIDER, else gist)",
	)
	parser.add_argument("--token", default="", help="GitHub token (default: $MGTD_GIST_TOKEN or $MGTD_REPO_TOKEN)")
	parser.add_argument("--gist-id", default=os.getenv("MGTD_GIST_ID", ""), help="GitHub gist id")
	parser.add_argument("--inbox-file", default=DEFAULT_INBOX_FILE, help="Inbox file inside the gist")
	parser.add_argument("--repo-owner", default=os.getenv("MGTD_REPO_OWNER", ""), help="GitHub repo owner")
	parser.add_argument("--repo-name", default=os.getenv("MGTD_REPO_NAME", ""), help="GitHub repo name")
	parser.add_argument("--repo-branch", default=os.getenv("MGTD_REPO_BRANCH", ""), help="Repo branch (default: main)")
	parser.add_argument(
		"--repo-path",
		default=os.getenv("MGTD_REPO_PATH", ""),
		help=f"Backup file path in the repo (default: {DEFAULT_REPO_PATH})",
	)
	parser.add_argument(
		"--repo-inbox-path",
		default=os.getenv("MGTD_REPO_INBOX_PATH", ""),
		help=f"Inbox file path in the repo (default: {DEFAULT_INBOX_FILE} next to the backup file)",
	)
	parser.add_argument("--source", default="python-cli", help="Source marker for queued line")
	parser.add_argument("--dry-run", action="store_true", help="Print the queued line without sending it")
	return parser.parse_intermixed_args(argv)


def github_request(
	method: str,
	url: str,
	token: str,
	body: Dict[str, Any] | None = None,
	accept: str = "application/vnd.github+json",
) -> bytes:
	payload = None
	headers = {
		"Accept": accept,
		"User-Agent": "MonkeyGTD-Python-CLI",
	}
	if token:
		headers["Authorization"] = f"token {token}"
	if body is not None:
		payload = json.dumps(body).encode("utf-8")
		headers["Content-Type"] = "application/json"

	req = Request(url=url, data=payload, headers=headers, method=method)
	with urlopen(req) as res:
		return res.read()


def request_json(method: str, url: str, token: str, body: Dict[str, Any] | None = None) -> Dict[str, Any]:
	return json.loads(github_request(method, url, token, body).decode("utf-8"))


def request_text(url: str) -> str:
	req = Request(url=url, headers={"User-Agent": "MonkeyGTD-Python-CLI"}, method="GET")
	with urlopen(req) as res:
		return res.read().decode("utf-8")


def parse_parent_task_id(value: str) -> str:
	"""Accept a bare id, '#task-<id>', or a full permalink URL ending in '#task-<id>'."""
	text = (value or "").strip()
	marker = "#task-"
	if marker in text:
		text = text.rsplit(marker, 1)[1]
	return text.strip()


def normalize_due(value: str) -> str:
	due = (value or "").strip()
	if not due:
		return ""
	if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", due):
		raise UsageError(f"Invalid --due '{value}'. Use YYYY-MM-DD.")
	try:
		dt.datetime.strptime(due, "%Y-%m-%d")
	except ValueError:
		raise UsageError(f"Invalid --due '{value}'. Use YYYY-MM-DD.") from None
	return due


def default_repo_inbox_path(backup_path: str) -> str:
	# Mirrors repoDefaultInboxPath() in js/infra/repo-sync.js.
	path = (backup_path or "").strip() or DEFAULT_REPO_PATH
	idx = path.rfind("/")
	if idx == -1:
		return DEFAULT_INBOX_FILE
	return f"{path[:idx]}/{DEFAULT_INBOX_FILE}"


def build_request(
	action: str,
	content: str,
	source: str,
	parent_task_id: str = "",
	list_id: str = "",
	due: str = "",
	asap: bool = False,
) -> Dict[str, Any]:
	req: Dict[str, Any] = {
		"id": str(uuid.uuid4()),
		"action": action,
	}
	if parent_task_id:
		req["parentTaskId"] = parent_task_id
	elif list_id:
		req["listId"] = list_id
	req["content"] = content
	if due:
		req["due"] = due
	elif asap:
		req["due_asap"] = True
	req["at"] = dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")
	req["source"] = source
	return req


def append_line(existing: str, line: str) -> str:
	trimmed = (existing or "").rstrip("\r\n")
	return line if not trimmed else f"{trimmed}\n{line}"


def get_existing_gist_inbox(meta: Dict[str, Any], inbox_file: str) -> str:
	files = meta.get("files") or {}
	file_info = files.get(inbox_file)
	if not file_info:
		return ""

	if not file_info.get("truncated"):
		return str(file_info.get("content") or "")

	raw_url = str(file_info.get("raw_url") or "")
	if not raw_url:
		return ""
	return request_text(raw_url)


def queue_to_gist(gist_id: str, token: str, inbox_file: str, line: str) -> None:
	gist_url = f"{GITHUB_API_URL}/gists/{quote(gist_id, safe='')}"
	meta = request_json("GET", gist_url, token)
	existing = get_existing_gist_inbox(meta, inbox_file)
	body = {"files": {inbox_file: {"content": append_line(existing, line)}}}
	request_json("PATCH", gist_url, token, body)


def repo_contents_url(owner: str, name: str, path: str) -> str:
	encoded_path = "/".join(quote(part, safe="") for part in path.split("/"))
	return f"{GITHUB_API_URL}/repos/{quote(owner, safe='')}/{quote(name, safe='')}/contents/{encoded_path}"


def queue_to_repo(owner: str, name: str, branch: str, inbox_path: str, token: str, line: str) -> None:
	url = repo_contents_url(owner, name, inbox_path)
	read_url = f"{url}?ref={quote(branch, safe='')}"

	existing = ""
	sha = ""
	try:
		meta = request_json("GET", read_url, token)
	except HTTPError as exc:
		if exc.code != 404:
			raise
		meta = None

	if isinstance(meta, list):
		raise UsageError(f"Repo inbox path points to a directory: {inbox_path}")
	if meta:
		sha = str(meta.get("sha") or "")
		encoded = re.sub(r"\s", "", str(meta.get("content") or ""))
		if encoded:
			existing = base64.b64decode(encoded).decode("utf-8")
		elif meta.get("size"):
			# Files over 1 MB come back without inline content.
			existing = github_request("GET", read_url, token, accept="application/vnd.github.raw").decode("utf-8")

	body: Dict[str, Any] = {
		"message": f"MonkeyGTD inbox queue {dt.datetime.now(dt.timezone.utc).isoformat()}",
		"content": base64.b64encode(append_line(existing, line).encode("utf-8")).decode("ascii"),
		"branch": branch,
	}
	if sha:
		body["sha"] = sha
	request_json("PUT", url, token, body)


def run(args: argparse.Namespace) -> int:
	provider = (args.provider or "").strip().lower()
	if provider not in ("gist", "repo"):
		raise UsageError(f"Unknown provider '{args.provider}'. Use gist or repo.")

	words = list(args.words)
	list_id = (args.list_id or "").strip()
	parent_task_id = ""
	if args.inbox or list_id:
		action = "addInbox"
	else:
		action = "addChild"
		parent_task_id = parse_parent_task_id(words.pop(0))
		if not parent_task_id:
			raise UsageError("ParentTaskId is required (or pass --inbox / --list-id).")
		# Tolerate the parent id being repeated as the first word of the text.
		if words and parse_parent_task_id(words[0]) == parent_task_id:
			words = words[1:]

	content = " ".join(words).strip()
	if not content:
		raise UsageError("Task text is required.")

	due = normalize_due(args.due)
	req = build_request(
		action,
		content,
		args.source,
		parent_task_id=parent_task_id,
		list_id=list_id,
		due=due,
		asap=args.asap,
	)
	line = json.dumps(req, separators=(",", ":"), ensure_ascii=False)

	if provider == "gist":
		gist_id = (args.gist_id or "").strip()
		token = (args.token or os.getenv("MGTD_GIST_TOKEN", "")).strip()
		target = f"gist '{gist_id or '<MGTD_GIST_ID not set>'}' file '{args.inbox_file}'"
	else:
		owner = (args.repo_owner or "").strip()
		name = (args.repo_name or "").strip()
		branch = (args.repo_branch or "").strip() or "main"
		inbox_path = (args.repo_inbox_path or "").strip() or default_repo_inbox_path(args.repo_path)
		token = (args.token or os.getenv("MGTD_REPO_TOKEN", "")).strip()
		target = f"repo '{owner or '<owner>'}/{name or '<name>'}' branch '{branch}' file '{inbox_path}'"

	if args.dry_run:
		print(f"Dry run: would queue {action} to {target}", file=sys.stderr)
		sys.stdout.buffer.write((line + "\n").encode("utf-8"))
		sys.stdout.flush()
		return 0

	if provider == "gist":
		if not gist_id:
			raise UsageError("Missing GistId. Pass --gist-id or set MGTD_GIST_ID.")
		if not token:
			raise UsageError("Missing token. Pass --token or set MGTD_GIST_TOKEN.")
		queue_to_gist(gist_id, token, args.inbox_file, line)
	else:
		if not owner or not name:
			raise UsageError("Missing repo. Pass --repo-owner/--repo-name or set MGTD_REPO_OWNER/MGTD_REPO_NAME.")
		if not token:
			raise UsageError("Missing token. Pass --token or set MGTD_REPO_TOKEN.")
		queue_to_repo(owner, name, branch, inbox_path, token, line)

	what = f"for parent '{parent_task_id}'" if parent_task_id else (f"for list '{list_id}'" if list_id else "for the Inbox list")
	print(f"Queued {action} request {what} in {target}.")
	return 0


def main() -> int:
	args = parse_args()
	try:
		return run(args)
	except UsageError as exc:
		print(str(exc), file=sys.stderr)
		return 2
	except HTTPError as exc:
		detail = ""
		try:
			detail = exc.read().decode("utf-8", errors="replace")
		except Exception:
			detail = str(exc)
		print(f"GitHub API request failed ({exc.code}): {detail}", file=sys.stderr)
		return 1
	except URLError as exc:
		print(f"Network error: {exc}", file=sys.stderr)
		return 1
	except Exception as exc:
		print(f"Unexpected error: {exc}", file=sys.stderr)
		return 1


if __name__ == "__main__":
	raise SystemExit(main())
