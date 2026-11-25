"use client";

/* A question that could not be answered: the server's plain note, and a way to ask again. Nothing was stored. */
export default function AnswerError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-2 rounded-xl border border-[#FDA29B] bg-[#FEF3F2] px-2.5 py-2 text-sm text-[#B42318]">
      <p>{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry}
          className="rounded-[10px] border border-[#FDA29B] bg-white px-3 py-1 text-xs font-semibold text-[#B42318] hover:bg-[#FEF3F2]">
          Try again
        </button>
      )}
    </div>
  );
}
