using System.Net.Sockets;

namespace ShinySolution.App;

public sealed class EmuLink : IDisposable
{
    readonly object _sync = new();
    TcpClient? _tcp;
    StreamWriter? _writer;
    int _session;
    readonly SynchronizationContext _ui;

    public event Action<string>? Log;
    public event Action<Dictionary<string, string>>? State;
    public event Action<bool>? ConnectedChanged;

    public bool IsConnected
    {
        get
        {
            lock (_sync) return _writer is not null && _tcp?.Connected == true;
        }
    }

    public EmuLink()
    {
        _ui = SynchronizationContext.Current ?? new SynchronizationContext();
    }

    void Post(Action action) => _ui.Post(_ => action(), null);

    /// <summary>The script that is supposed to be listening, and the port it listens on by default.
    /// Set by each panel so a refused connection can say what to actually DO about it instead of
    /// handing the user a raw socket error - the failure that cost a viewer an evening: the port box
    /// held 8537, the script was on 8357, and "target machine actively refused it" named neither.</summary>
    public string ScriptName { get; set; } = "the Shiny-Solution script";
    public int ExpectedPort { get; set; }

    /// <summary>How long to wait before calling a connection refused. A wrong HOST (as opposed to a
    /// wrong port) does not refuse, it hangs, and an untimed Connect would hang with it.</summary>
    static readonly TimeSpan ConnectTimeout = TimeSpan.FromSeconds(5);

    string ExplainFailure(Exception ex, string host, int port)
    {
        var refused = ex is SocketException { SocketErrorCode: SocketError.ConnectionRefused };
        var timedOut = ex is TimeoutException
            || ex is SocketException { SocketErrorCode: SocketError.TimedOut };
        if (!refused && !timedOut)
            return $"link error: {ex.Message}";

        var what = refused
            ? $"Nothing is listening on {host}:{port}."
            : $"No answer from {host}:{port} within {ConnectTimeout.TotalSeconds:0} seconds.";

        var portHint = ExpectedPort > 0 && port != ExpectedPort
            ? $" THE PORT LOOKS WRONG: this tab's script listens on {ExpectedPort}, not {port}."
                + " Fix the port box and press Connect again."
            : $" Load {ScriptName} in mGBA first (Tools > Scripting > File > Load script), and check the"
                + " port in the box matches the one mGBA's scripting window printed.";

        return what + portHint;
    }

    public void Connect(string host, int port)
    {
        int session;
        lock (_sync)
        {
            session = ++_session;
            try { _tcp?.Close(); } catch { }
            _tcp = null;
            _writer = null;
        }
        new Thread(() =>
        {
            TcpClient? tcp = null;
            bool owned = false;
            try
            {
                tcp = new TcpClient();
                if (!tcp.ConnectAsync(host, port).Wait(ConnectTimeout))
                    throw new TimeoutException($"no answer from {host}:{port}");
                var stream = tcp.GetStream();
                var writer = new StreamWriter(stream) { AutoFlush = true, NewLine = "\n" };
                lock (_sync)
                {
                    if (session != _session)
                    {
                        tcp.Close();
                        return;
                    }
                    _tcp = tcp;
                    _writer = writer;
                    owned = true;
                }
                Post(() =>
                {
                    ConnectedChanged?.Invoke(true);
                    Log?.Invoke($"connected to {host}:{port}");
                });
                using var reader = new StreamReader(stream);
                while (true)
                {
                    var line = reader.ReadLine();
                    if (line is null) break;
                    lock (_sync)
                    {
                        if (session != _session) return;
                    }
                    HandleLine(line);
                }
            }
            catch (Exception ex)
            {
                bool current;
                lock (_sync) current = session == _session;
                var explained = ExplainFailure(ex is AggregateException agg && agg.InnerException is { } inner
                    ? inner : ex, host, port);
                if (current) Post(() => Log?.Invoke(explained));
            }
            finally
            {
                bool current = false;
                lock (_sync)
                {
                    if (session == _session)
                    {
                        current = true;
                        _tcp = null;
                        _writer = null;
                    }
                }
                if (!owned) try { tcp?.Close(); } catch { }
                if (current) Post(() => ConnectedChanged?.Invoke(false));
            }
        })
        { IsBackground = true }.Start();
    }

    void HandleLine(string line)
    {
        if (line.StartsWith("STATE "))
        {
            var fields = new Dictionary<string, string>();
            foreach (var token in line[6..].Split(' ', StringSplitOptions.RemoveEmptyEntries))
            {
                var eq = token.IndexOf('=');
                if (eq > 0) fields[token[..eq]] = token[(eq + 1)..];
            }
            Post(() => State?.Invoke(fields));
        }
        else if (line.StartsWith("LOG "))
        {
            var msg = line[4..];
            Post(() => Log?.Invoke(msg));
        }
        else
        {
            Post(() => Log?.Invoke(line));
        }
    }

    public void Send(string command)
    {
        StreamWriter? writer;
        lock (_sync) writer = _writer;
        try
        {
            writer?.WriteLine(command);
        }
        catch (Exception ex)
        {
            Post(() => Log?.Invoke($"send failed: {ex.Message}"));
        }
    }

    public void Disconnect()
    {
        lock (_sync)
        {
            _session++;
            try { _tcp?.Close(); } catch { }
            _tcp = null;
            _writer = null;
        }
        Post(() => ConnectedChanged?.Invoke(false));
    }

    public void Dispose() => Disconnect();
}
