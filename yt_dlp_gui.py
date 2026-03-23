import importlib.util
import os
import queue
import re
import shutil
import subprocess
import sys
import threading
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, scrolledtext, ttk
from typing import Optional


FORMAT_OPTIONS = {
    "Best quality": {
        "args": ["-f", "bv*+ba/b"],
        "description": "Downloads the best available video and audio.",
    },
    "Audio only": {
        "args": ["-f", "bestaudio/best"],
        "description": "Downloads the best available audio stream.",
    },
    "1080p": {
        "args": ["-f", "bestvideo[height<=1080]+bestaudio/best[height<=1080]"],
        "description": "Limits video quality to 1080p or lower.",
    },
    "720p": {
        "args": ["-f", "bestvideo[height<=720]+bestaudio/best[height<=720]"],
        "description": "Limits video quality to 720p or lower.",
    },
    "480p": {
        "args": ["-f", "bestvideo[height<=480]+bestaudio/best[height<=480]"],
        "description": "Limits video quality to 480p or lower.",
    },
}


class YtDlpGui:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.root.title("yt-dlp Downloader")
        self.root.geometry("900x680")
        self.root.minsize(760, 620)

        self.message_queue: queue.Queue[tuple[str, object]] = queue.Queue()
        self.download_thread: Optional[threading.Thread] = None

        default_dir = str(Path.home() / "Downloads")
        self.url_var = tk.StringVar()
        self.folder_var = tk.StringVar(value=default_dir)
        self.format_var = tk.StringVar(value="Best quality")
        self.status_var = tk.StringVar(value="Ready")
        self.progress_var = tk.DoubleVar(value=0)
        self.helper_var = tk.StringVar(
            value=FORMAT_OPTIONS[self.format_var.get()]["description"]
        )

        self._configure_theme()
        self._build_layout()
        self._poll_queue()

    def _configure_theme(self) -> None:
        bg = "#0f0f10"
        panel = "#17181a"
        field = "#1f2023"
        text = "#f4f4f5"
        muted = "#9a9ca3"
        accent = "#f5f5f5"
        accent_text = "#111214"
        border = "#2a2b30"
        progress_trough = "#232428"

        self.colors = {
            "bg": bg,
            "panel": panel,
            "field": field,
            "text": text,
            "muted": muted,
            "accent": accent,
            "accent_text": accent_text,
            "border": border,
            "progress_trough": progress_trough,
        }

        self.root.configure(bg=bg)
        style = ttk.Style()
        try:
            style.theme_use("clam")
        except tk.TclError:
            pass

        style.configure(".", background=bg, foreground=text, fieldbackground=field)
        style.configure(
            "Card.TFrame",
            background=panel,
            borderwidth=0,
            relief="flat",
        )
        style.configure(
            "App.TLabel",
            background=bg,
            foreground=text,
            font=("SF Pro Display", 13),
        )
        style.configure(
            "Muted.TLabel",
            background=panel,
            foreground=muted,
            font=("SF Pro Display", 11),
        )
        style.configure(
            "Title.TLabel",
            background=bg,
            foreground=text,
            font=("SF Pro Display", 28, "bold"),
        )
        style.configure(
            "Section.TLabel",
            background=panel,
            foreground=text,
            font=("SF Pro Display", 12, "bold"),
        )
        style.configure(
            "Modern.TEntry",
            foreground=text,
            fieldbackground=field,
            background=field,
            bordercolor=border,
            lightcolor=border,
            darkcolor=border,
            insertcolor=text,
            padding=(14, 12),
            relief="flat",
        )
        style.map("Modern.TEntry", bordercolor=[("focus", accent)])

        style.configure(
            "Modern.TCombobox",
            foreground=text,
            fieldbackground=field,
            background=field,
            arrowcolor=text,
            bordercolor=border,
            lightcolor=border,
            darkcolor=border,
            padding=(12, 10),
            relief="flat",
        )
        style.map(
            "Modern.TCombobox",
            fieldbackground=[("readonly", field)],
            selectbackground=[("readonly", field)],
            selectforeground=[("readonly", text)],
            bordercolor=[("focus", accent)],
        )

        style.configure(
            "Primary.TButton",
            background=accent,
            foreground=accent_text,
            borderwidth=0,
            focusthickness=0,
            focuscolor=accent,
            padding=(16, 12),
            font=("SF Pro Display", 12, "bold"),
            relief="flat",
        )
        style.map(
            "Primary.TButton",
            background=[("active", "#ffffff"), ("disabled", "#7c7d82")],
            foreground=[("disabled", "#e4e4e7")],
        )

        style.configure(
            "Secondary.TButton",
            background=field,
            foreground=text,
            borderwidth=0,
            focusthickness=0,
            padding=(14, 12),
            font=("SF Pro Display", 11, "bold"),
            relief="flat",
        )
        style.map(
            "Secondary.TButton",
            background=[("active", "#2a2b30"), ("disabled", "#202126")],
            foreground=[("disabled", "#7c7d82")],
        )

        style.configure(
            "Modern.Horizontal.TProgressbar",
            troughcolor=progress_trough,
            bordercolor=progress_trough,
            background=accent,
            lightcolor=accent,
            darkcolor=accent,
            thickness=10,
        )

    def _build_layout(self) -> None:
        outer = tk.Frame(self.root, bg=self.colors["bg"])
        outer.pack(fill="both", expand=True, padx=28, pady=24)
        outer.grid_columnconfigure(0, weight=1)

        header = tk.Frame(outer, bg=self.colors["bg"])
        header.grid(row=0, column=0, sticky="ew", pady=(0, 18))
        header.grid_columnconfigure(0, weight=1)

        ttk.Label(header, text="yt-dlp Downloader", style="Title.TLabel").grid(
            row=0, column=0, sticky="w"
        )
        ttk.Label(
            header,
            text="Paste a link, pick a format, and download without touching the terminal.",
            style="App.TLabel",
        ).grid(row=1, column=0, sticky="w", pady=(6, 0))

        card = ttk.Frame(outer, style="Card.TFrame", padding=22)
        card.grid(row=1, column=0, sticky="nsew")
        outer.grid_rowconfigure(1, weight=1)
        card.grid_columnconfigure(0, weight=1)
        card.grid_columnconfigure(1, weight=0)
        card.grid_rowconfigure(7, weight=1)

        ttk.Label(card, text="Video URL", style="Section.TLabel").grid(
            row=0, column=0, sticky="w", columnspan=2
        )
        self.url_entry = ttk.Entry(card, textvariable=self.url_var, style="Modern.TEntry")
        self.url_entry.grid(row=1, column=0, sticky="ew", columnspan=2, pady=(8, 18))

        ttk.Label(card, text="Download format", style="Section.TLabel").grid(
            row=2, column=0, sticky="w"
        )
        self.format_combo = ttk.Combobox(
            card,
            textvariable=self.format_var,
            values=list(FORMAT_OPTIONS.keys()),
            state="readonly",
            style="Modern.TCombobox",
        )
        self.format_combo.grid(row=3, column=0, sticky="ew", padx=(0, 12), pady=(8, 0))
        self.format_combo.bind("<<ComboboxSelected>>", self._on_format_changed)

        self.download_button = ttk.Button(
            card,
            text="Start download",
            command=self.start_download,
            style="Primary.TButton",
        )
        self.download_button.grid(row=3, column=1, sticky="ew", pady=(8, 0))

        ttk.Label(card, textvariable=self.helper_var, style="Muted.TLabel").grid(
            row=4, column=0, columnspan=2, sticky="w", pady=(10, 18)
        )

        ttk.Label(card, text="Output folder", style="Section.TLabel").grid(
            row=5, column=0, sticky="w", columnspan=2
        )

        folder_row = tk.Frame(card, bg=self.colors["panel"])
        folder_row.grid(row=6, column=0, columnspan=2, sticky="ew", pady=(8, 18))
        folder_row.grid_columnconfigure(0, weight=1)

        self.folder_entry = ttk.Entry(
            folder_row, textvariable=self.folder_var, style="Modern.TEntry"
        )
        self.folder_entry.grid(row=0, column=0, sticky="ew", padx=(0, 12))
        ttk.Button(
            folder_row,
            text="Choose folder",
            command=self.choose_folder,
            style="Secondary.TButton",
        ).grid(row=0, column=1, sticky="ew")

        progress_panel = tk.Frame(card, bg=self.colors["panel"])
        progress_panel.grid(row=7, column=0, columnspan=2, sticky="nsew")
        progress_panel.grid_columnconfigure(0, weight=1)
        progress_panel.grid_rowconfigure(3, weight=1)

        ttk.Label(progress_panel, text="Progress", style="Section.TLabel").grid(
            row=0, column=0, sticky="w"
        )
        ttk.Label(progress_panel, textvariable=self.status_var, style="Muted.TLabel").grid(
            row=0, column=1, sticky="e"
        )

        self.progress = ttk.Progressbar(
            progress_panel,
            variable=self.progress_var,
            maximum=100,
            style="Modern.Horizontal.TProgressbar",
        )
        self.progress.grid(row=1, column=0, columnspan=2, sticky="ew", pady=(10, 14))

        ttk.Label(progress_panel, text="Activity log", style="Section.TLabel").grid(
            row=2, column=0, sticky="w", pady=(4, 8)
        )

        self.log_widget = scrolledtext.ScrolledText(
            progress_panel,
            bg=self.colors["field"],
            fg=self.colors["text"],
            insertbackground=self.colors["text"],
            highlightthickness=1,
            highlightbackground=self.colors["border"],
            highlightcolor=self.colors["accent"],
            relief="flat",
            bd=0,
            font=("SF Mono", 11),
            wrap="word",
            padx=14,
            pady=14,
        )
        self.log_widget.grid(row=3, column=0, columnspan=2, sticky="nsew")
        self.log_widget.configure(state="disabled")

    def _on_format_changed(self, _event: Optional[object] = None) -> None:
        self.helper_var.set(FORMAT_OPTIONS[self.format_var.get()]["description"])

    def choose_folder(self) -> None:
        selected = filedialog.askdirectory(initialdir=self.folder_var.get() or str(Path.home()))
        if selected:
            self.folder_var.set(selected)

    def start_download(self) -> None:
        if self.download_thread and self.download_thread.is_alive():
            return

        url = self.url_var.get().strip()
        output_dir = self.folder_var.get().strip()
        selection = self.format_var.get()

        if not url:
            messagebox.showerror("Missing URL", "Paste a video URL before starting the download.")
            return

        if selection not in FORMAT_OPTIONS:
            messagebox.showerror("Invalid format", "Choose a valid download format.")
            return

        if not output_dir:
            messagebox.showerror("Missing folder", "Choose where the download should be saved.")
            return

        os.makedirs(output_dir, exist_ok=True)

        command = self._build_command(url=url, output_dir=output_dir, selection=selection)
        if not command:
            self._append_log(
                "yt-dlp was not found. Install it with `pip install yt-dlp` or make the `yt-dlp` command available."
            )
            self.status_var.set("yt-dlp not found")
            return

        self.progress_var.set(0)
        self.status_var.set("Starting download...")
        self._append_log("")
        self._append_log(f"Starting download for: {url}")
        self._append_log(f"Saving to: {output_dir}")
        self._append_log(f"Format: {selection}")

        self.download_button.state(["disabled"])
        self.download_thread = threading.Thread(
            target=self._run_download,
            args=(command,),
            daemon=True,
        )
        self.download_thread.start()

    def _build_command(
        self, url: str, output_dir: str, selection: str
    ) -> Optional[list[str]]:
        yt_dlp_path = shutil.which("yt-dlp")
        if yt_dlp_path:
            base_command = [yt_dlp_path]
        elif importlib.util.find_spec("yt_dlp") is not None:
            base_command = [sys.executable, "-m", "yt_dlp"]
        else:
            return None

        template = os.path.join(output_dir, "%(title)s.%(ext)s")
        return base_command + [
            "--newline",
            "--no-playlist",
            "--progress",
            *FORMAT_OPTIONS[selection]["args"],
            "-o",
            template,
            url,
        ]

    def _run_download(self, command: list[str]) -> None:
        try:
            process = subprocess.Popen(
                command,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
            )
        except Exception as exc:  # pragma: no cover - UI level fallback
            self.message_queue.put(("error", f"Failed to launch yt-dlp: {exc}"))
            self.message_queue.put(("done", 1))
            return

        if not process.stdout:
            self.message_queue.put(("error", "yt-dlp did not provide any output stream."))
            self.message_queue.put(("done", 1))
            return

        percent_re = re.compile(r"(\d+(?:\.\d+)?)%")

        for raw_line in process.stdout:
            line = raw_line.strip()
            if not line:
                continue

            self.message_queue.put(("log", line))

            match = percent_re.search(line)
            if match:
                self.message_queue.put(("progress", float(match.group(1))))

            if "[download]" in line and "Destination:" in line:
                self.message_queue.put(("status", "Preparing file..."))
            elif "[download]" in line and "has already been downloaded" in line:
                self.message_queue.put(("status", "Already downloaded"))
            elif "[download]" in line and "100%" in line:
                self.message_queue.put(("status", "Finalizing..."))
            elif "ERROR:" in line:
                self.message_queue.put(("status", "Download failed"))

        exit_code = process.wait()
        self.message_queue.put(("done", exit_code))

    def _poll_queue(self) -> None:
        try:
            while True:
                kind, payload = self.message_queue.get_nowait()
                if kind == "log":
                    self._append_log(str(payload))
                elif kind == "progress":
                    self.progress_var.set(float(payload))
                    self.status_var.set(f"Downloading... {float(payload):.1f}%")
                elif kind == "status":
                    self.status_var.set(str(payload))
                elif kind == "error":
                    self._append_log(str(payload))
                    self.status_var.set("Error")
                elif kind == "done":
                    exit_code = int(payload)
                    if exit_code == 0:
                        self.progress_var.set(100)
                        self.status_var.set("Download complete")
                        self._append_log("Download finished successfully.")
                    else:
                        self.status_var.set(f"Download failed (exit code {exit_code})")
                    self.download_button.state(["!disabled"])
        except queue.Empty:
            pass
        finally:
            self.root.after(100, self._poll_queue)

    def _append_log(self, message: str) -> None:
        self.log_widget.configure(state="normal")
        self.log_widget.insert("end", f"{message}\n")
        self.log_widget.see("end")
        self.log_widget.configure(state="disabled")


def main() -> None:
    root = tk.Tk()
    app = YtDlpGui(root)
    app.url_entry.focus_set()
    root.mainloop()


if __name__ == "__main__":
    main()
