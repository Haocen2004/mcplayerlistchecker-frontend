"use client";

import { KeyRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export function PasswordForm() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (newPassword !== confirmPassword) {
      setError("两次输入的新密码不一致");
      return;
    }

    setLoading(true);
    const response = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword })
    });
    const body = await response.json().catch(() => null);
    setLoading(false);

    if (!response.ok || !body?.ok) {
      setError(body?.error || "密码修改失败");
      return;
    }

    router.replace("/");
    router.refresh();
  }

  return (
    <main className="min-h-screen px-5 py-10 flex items-center justify-center">
      <form onSubmit={submit} className="panel w-full max-w-sm p-6 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-md bg-slate-900 text-white">
            <KeyRound size={20} aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">设置管理员密码</h1>
            <p className="text-sm text-slate-500">首次默认密码登录后必须修改</p>
          </div>
        </div>

        <label className="mb-4 block">
          <span className="mb-1 block text-sm text-slate-600">当前密码</span>
          <input
            value={currentPassword}
            onChange={event => setCurrentPassword(event.target.value)}
            type="password"
            autoComplete="current-password"
            className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 outline-none focus:border-blue-600"
            required
          />
        </label>

        <label className="mb-4 block">
          <span className="mb-1 block text-sm text-slate-600">新密码</span>
          <input
            value={newPassword}
            onChange={event => setNewPassword(event.target.value)}
            type="password"
            autoComplete="new-password"
            className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 outline-none focus:border-blue-600"
            minLength={6}
            required
          />
        </label>

        <label className="mb-4 block">
          <span className="mb-1 block text-sm text-slate-600">确认新密码</span>
          <input
            value={confirmPassword}
            onChange={event => setConfirmPassword(event.target.value)}
            type="password"
            autoComplete="new-password"
            className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 outline-none focus:border-blue-600"
            minLength={6}
            required
          />
        </label>

        {error ? <p className="mb-4 text-sm text-red-700">{error}</p> : null}

        <button
          disabled={loading}
          className="h-10 w-full rounded-md bg-slate-900 px-4 font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "保存中" : "保存并进入面板"}
        </button>
      </form>
    </main>
  );
}
