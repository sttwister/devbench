import Terminal from "./Terminal";

interface TerminalPaneProps {
  sessionId: number | null;
}

export default function TerminalPane({ sessionId }: TerminalPaneProps) {
  if (sessionId === null) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-950">
        <div className="text-center">
          <p className="text-gray-500 text-lg">Select a session</p>
          <p className="text-gray-600 text-sm mt-1">
            Create a project and session from the sidebar
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-hidden bg-black">
      <Terminal key={sessionId} sessionId={sessionId} />
    </div>
  );
}
