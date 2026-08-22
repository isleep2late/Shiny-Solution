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
                tcp.Connect(host, port);
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
                if (current) Post(() => Log?.Invoke($"link error: {ex.Message}"));
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
