using System.Text.Json;
using ShinySolution.App;
using ShinySolution.Core;

// The desktop head's rendered verification claims, for the cross-head claims guard
// (tests/check-verification-claims.cjs). Nothing is judged here: this only writes what
// app/App/Gen1TidSupport.cs actually prints for every supported game on every platform it
// offers, so the guard reads the real rendered strings of both heads and not a re-derivation.
static class Gen1ClaimsEmit
{
    public static int Run(string outPath, string? dataPath, string? citationsPath)
    {
        // the panel prints the target line with its footnote marks, so the emission carries them too
        Citations.LoadCitations(citationsPath);
        var data = dataPath is null ? Gen1TidData.LoadEmbedded() : Gen1TidData.LoadFile(dataPath);
        var platforms = new List<object>();
        foreach (var game in Gen1Platform.SupportedGames(data))
        {
            foreach (var (key, _, _) in Gen1Platform.PlatformsFor(data, game))
            {
                var p = Gen1Platform.Resolve(data, game, key, null, null);
                var targets = new List<object>();
                for (int o = 0; o <= p.MaxOffset; o++)
                {
                    string tag = Gen1TidText.DerivationTag(p, o);
                    if (tag == "" && !p.Timing.VerifiedTargets.Contains(o)) continue;
                    targets.Add(new
                    {
                        offset = o,
                        tid = Gen1Tid.FormatTid(p.Table[o]),
                        verified = p.Timing.VerifiedTargets.Contains(o),
                        tag,
                        line = Gen1TidText.DescribeTarget(p, o),
                    });
                }
                platforms.Add(new
                {
                    game,
                    platform = key,
                    methodologyId = p.MethodologyId,
                    family = p.FamilyKey,
                    verifiedTargets = p.Timing.VerifiedTargets,
                    evidence = p.Timing.VerifiedTargetsEvidence,
                    note = p.Timing.VerifiedTargetsNote,
                    evidenceInRepo = p.Timing.VerifiedEvidenceInRepo,
                    verificationLines = Gen1TidText.VerificationLines(p, "  "),
                    targets,
                });
            }
        }
        var doc = new
        {
            head = "csharp (app/App/Gen1TidSupport.cs)",
            dataSource = dataPath ?? "embedded core/data/gen1-tid.json",
            citationsLoaded = Citations.Loaded,
            flatTag = Gen1TidText.VerifiedTag,
            offRepoTag = Gen1TidText.VerifiedOffRepoTag,
            oneDerivationTag = Gen1TidText.OneDerivationTag,
            platforms,
        };
        File.WriteAllText(outPath, JsonSerializer.Serialize(doc, new JsonSerializerOptions { WriteIndented = true }));
        Console.WriteLine($"gen1 verification claims (C# head) written to {outPath}: {platforms.Count} platforms");
        return 0;
    }
}
