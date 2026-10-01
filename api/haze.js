// Small server function: asks NEA for the latest readings and hands them to the page.
// Runs on Vercel. The page calls it at /api/haze.
const BASE = "https://api-open.data.gov.sg/v2/real-time/api/";

module.exports = async (req, res) => {
  try {
    const [pm25, psi] = await Promise.all(
      ["pm25", "psi"].map(async (name) => {
        const r = await fetch(BASE + name, { signal: AbortSignal.timeout(5000) }); // give up after 5 seconds
        if (!r.ok) throw new Error(name + " " + r.status);
        return r.json();
      })
    );
    // Keep a copy for 5 minutes so NEA is not asked on every visit.
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    res.status(200).json({ pm25, psi });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
};
