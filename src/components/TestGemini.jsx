// src/components/TestGemini.jsx
import { useState } from "react";
import { geminiModel } from "../lib/ai";

export default function TestGemini() {
  const [output, setOutput] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    setOutput("");
    try {
      const prompt = "Tulis cerita pendek tentang ransel ajaib di sekolah.";
      const result = await geminiModel.generateContent(prompt);
      const text = result.response.text();
      setOutput(text);
    } catch (err) {
      console.error(err);
      setOutput("Terjadi error saat memanggil Gemini.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ padding: 16 }}>
      <button
        onClick={handleClick}
        disabled={loading}
        style={{
          padding: "8px 16px",
          borderRadius: 8,
          border: "none",
          background: "#2563EB",
          color: "white",
          cursor: "pointer",
          opacity: loading ? 0.7 : 1,
        }}
      >
        {loading ? "Menghasilkan..." : "Tes Gemini"}
      </button>

      {output && (
        <pre
          style={{
            marginTop: 16,
            background: "#f3f4f6",
            padding: 12,
            borderRadius: 8,
            whiteSpace: "pre-wrap",
          }}
        >
          {output}
        </pre>
      )}
    </div>
  );
}
