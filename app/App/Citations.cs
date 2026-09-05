using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using ShinySolution.Core;

namespace ShinySolution.App;

// The decomp citation footnotes shared by the Gen 1 TID, Gen 2 TID and wizard panels: the twin of webapp/footnotes.js,
// the web tabs' texts word for word. The registry core/data/citations.json (generated from docs/FACTS.md by
// tools/gen-citations.py, every cited line read in pret) is embedded in the Core assembly as data.citations, a copy
// beside the executable preferred, or the file given to LoadCitations (app/Tests, whose negative controls pass a copy
// with one entry removed). A panel marks each protocol step, target line, schedule line or verify line with [^n] over
// its table of sources and lists them as a Sources block: a decomp line is printed with the docs/FACTS.md section the
// registry files it under (or the one the source names, when the registry files the line under several: it must be one
// of them); a source with no decomp line is SYNTHESISED (a timer model, a community convention) or,
// when it is a measured constant, printed under its validation status word (EMULATOR-EXACT, HARDWARE-VALIDATED n,
// EMPIRICAL); a citation the registry does not carry is printed as NOT IN THE REGISTRY, which ProcedureProblems reports.
public static class Citations
{
    public const string Header = "Sources: decomp lines from docs/FACTS.md through the registry core/data/citations.json; SYNTHESISED marks a source with no decomp line.";
    public const string StatusNote = " A measured source is printed under its validation status: EMULATOR-EXACT, HARDWARE-VALIDATED n or EMPIRICAL.";

    static Dictionary<string, List<string>>? _citations;
    static bool _citationsTried;
    public static bool Loaded { get { Ensure(); return _citations is not null; } }
    public static void SetCitations(JsonElement? registry)
    {
        _citationsTried = true;
        _citations = null;
        if (registry is not JsonElement r || r.ValueKind != JsonValueKind.Object || !r.TryGetProperty("entries", out var entries) || entries.ValueKind != JsonValueKind.Array) return;
        var by = new Dictionary<string, List<string>>();
        foreach (var e in entries.EnumerateArray())
        {
            // the sections that cite the line, the first being the entry's section (an older registry carries only that one)
            var sections = new List<string>();
            if (e.TryGetProperty("sections", out var list) && list.ValueKind == JsonValueKind.Array)
                foreach (var s in list.EnumerateArray()) if (s.ValueKind == JsonValueKind.String) sections.Add(s.GetString() ?? "");
            if (sections.Count == 0) sections.Add(e.TryGetProperty("section", out var one) && one.ValueKind == JsonValueKind.String ? one.GetString() ?? "" : "");
            by[e.TryGetProperty("cite", out var c) && c.ValueKind == JsonValueKind.String ? c.GetString() ?? "" : ""] = sections;
        }
        _citations = by;
    }
    public static void LoadCitations(string? path = null)
    {
        var beside = Path.Combine(AppContext.BaseDirectory, "citations.json");
        try
        {
            if (path is not null) SetCitations(JsonDocument.Parse(File.ReadAllText(path)).RootElement.Clone());
            else if (File.Exists(beside)) SetCitations(JsonDocument.Parse(File.ReadAllText(beside)).RootElement.Clone());
            else
            {
                using var stream = typeof(Generators).Assembly.GetManifestResourceStream("data.citations");
                if (stream is null) { SetCitations(null); return; }
                using var reader = new StreamReader(stream, Encoding.UTF8);
                SetCitations(JsonDocument.Parse(reader.ReadToEnd()).RootElement.Clone());
            }
        }
        catch (Exception) when (path is null) { SetCitations(null); }
    }
    static void Ensure() { if (!_citationsTried) LoadCitations(); }

    // one source: Cite a decomp line (under the named Section, one of the FACTS.md sections that cite it, when given);
    // Synth no decomp line; Measured a measured constant under its Status word (EMPIRICAL when none is given)
    public sealed record CiteSource(string? Cite, string? Synth, string Claim, string? Measured = null, string? Status = null, string? Section = null);

    public static string FootnoteText(int n, CiteSource src)
    {
        string head = "[^" + n + "] ";
        if (src.Synth is not null) return head + "SYNTHESISED (no decomp line; " + src.Synth + "): " + src.Claim;
        if (src.Measured is not null) return head + (src.Status ?? "EMPIRICAL") + " (no decomp line; " + src.Measured + "): " + src.Claim;
        Ensure();
        if (_citations is null || !_citations.TryGetValue(src.Cite ?? "", out var sections))
            return head + src.Cite + " NOT IN THE REGISTRY (" + (_citations is not null ? "core/data/citations.json carries no such line of docs/FACTS.md" : "no citation registry is loaded") + "): " + src.Claim;
        string section = sections[0];
        if (src.Section is not null)
        {
            if (!sections.Contains(src.Section)) return head + src.Cite + " NOT IN THE REGISTRY (core/data/citations.json files that line under no docs/FACTS.md section named " + src.Section + "): " + src.Claim;
            section = src.Section;
        }
        return head + src.Cite + " (docs/FACTS.md: " + section + "): " + src.Claim;
    }

    // one procedure's footnotes over a table of sources: Mark(keys) returns the markers for a line, Lines() the Sources
    // block. With no order the numbers follow the order of first use (the wizard); with an order the numbers are fixed
    // up front, so a line rendered apart from the block (a target line, a verify output) carries the block's numbers,
    // and the block lists the sources used, in that order.
    public sealed class Footnotes
    {
        readonly IReadOnlyDictionary<string, CiteSource> _sources;
        readonly List<string> _keys;
        readonly HashSet<string> _used = new();
        readonly bool _ordered;
        public Footnotes(IReadOnlyDictionary<string, CiteSource> sources, IEnumerable<string>? order = null)
        {
            _sources = sources;
            _keys = order is null ? new List<string>() : order.ToList();
            _ordered = order is not null;
            foreach (var k in _keys) if (!_sources.ContainsKey(k)) throw new ArgumentException("no source named " + k);
        }
        public string Mark(params string[] keys)
        {
            var sb = new StringBuilder();
            foreach (var k in keys)
            {
                if (!_sources.ContainsKey(k)) throw new ArgumentException("no source named " + k);
                int i = _keys.IndexOf(k);
                if (i < 0) { _keys.Add(k); i = _keys.Count - 1; }
                _used.Add(k);
                sb.Append(" [^").Append(i + 1).Append(']');
            }
            return sb.ToString();
        }
        public List<string> Lines()
        {
            bool measured = _keys.Where(k => !_ordered || _used.Contains(k)).Any(k => _sources[k].Measured is not null);
            var out_ = new List<string> { Header + (measured ? StatusNote : "") };
            for (int i = 0; i < _keys.Count; i++) if (!_ordered || _used.Contains(_keys[i])) out_.Add("  " + FootnoteText(i + 1, _sources[_keys[i]]));
            return out_;
        }
    }

    static readonly Regex ProblemLine = new(@"^  \[\^\d+\] .* NOT IN THE REGISTRY \(", RegexOptions.Compiled);
    public static List<string> ProcedureProblems(IEnumerable<string> lines) => lines.Where(l => ProblemLine.IsMatch(l)).ToList();
}
