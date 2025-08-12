import { useState, useEffect, useRef } from 'react';

// Declare a global interface for the Window object to include 'io'
// This is necessary because the socket.io-client library is loaded via a script tag
// and TypeScript doesn't know about the `io` property on the global window object by default.
declare global {
  // Define the type for the Socket.io client socket object
  interface Socket {
    on(event: string, callback: (...args: any[]) => void): void;
    emit(event: string, ...args: any[]): void;
    disconnect(): void;
  }
  
  interface Window {
    io: (url: string) => Socket;
    // We add a global variable for the backend URL, as 'process.env' is not available in the browser.
    REACT_APP_BACKEND_URL: string;
  }
}

// Define the type for a Player object to ensure type safety throughout the application.
interface Player {
  id: string;
  name: string;
  vote: number | '?' | null;
}

// The main application component for the Planning Poker game.
// It manages the state of the game, including card selection and revealing votes.
const App = () => {
  // Fibonacci sequence for planning poker cards.
  const cards = [1, 2, 3, 5, 8, 13, 21];

  // State variables for the game
  const [selectedCard, setSelectedCard] = useState<number | null>(null);
  const [roomId, setRoomId] = useState<string>('');
  const [playerName, setPlayerName] = useState<string>('');
  const [players, setPlayers] = useState<Player[]>([]);
  const [isRevealed, setIsRevealed] = useState<boolean>(false);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  // Refs for direct access to DOM elements and the socket instance
  const socketRef = useRef<Socket | null>(null);
  const roomIdInputRef = useRef<HTMLInputElement>(null);
  const playerNameInputRef = useRef<HTMLInputElement>(null);

  // This hook handles the initial connection to the backend and sets up event listeners.
  useEffect(() => {
    // Determine the backend URL based on environment variables for deployment
    // We use a global `window` variable as `process.env` is not available in the browser.
    // For deployment, you would need to set `window.REACT_APP_BACKEND_URL` on the page.
    // NOTE: The protocol `https://` is crucial here to ensure the browser makes an absolute request.
    const backendUrl = 'https://pythonpoker-production.up.railway.app';

    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/socket.io/4.7.5/socket.io.js';
    script.onload = () => {
      // Connect to the backend server after the library is loaded.
      if (window.io) {
        socketRef.current = window.io(backendUrl);
        const socket = socketRef.current;

        socket.on('connect', () => {
          console.log('Connected to backend.');
          setIsConnected(true);
        });

        socket.on('disconnect', () => {
          console.log('Disconnected from backend.');
          setIsConnected(false);
          setRoomId('');
          setPlayers([]);
        });

        socket.on('player_list_update', (data: Player[]) => {
          setPlayers(data);
        });

        socket.on('player_voted', (data: { playerId: string }) => {
          setPlayers(prevPlayers => prevPlayers.map(p =>
            p.id === data.playerId ? { ...p, vote: '?' } : p
          ));
        });

        socket.on('votes_revealed', (data: Player[]) => {
          setPlayers(data);
          setIsRevealed(true);
        });

        socket.on('game_reset', (data: Player[]) => {
          setPlayers(data);
          setSelectedCard(null);
          setIsRevealed(false);
        });

        socket.on('error', (data: { message: string }) => {
          setError(data.message);
        });
      }
    };
    document.head.appendChild(script);

    // Clean up the socket connection and the script tag on component unmount.
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
      const script = document.querySelector('script[src="https://cdnjs.cloudflare.com/ajax/libs/socket.io/4.7.5/socket.io.js"]');
      if (script) {
        document.head.removeChild(script);
      }
    };
  }, []);

  // Calculate the average of the revealed votes.
  const calculateAverage = (): string => {
    const votes = players.map(p => p.vote).filter(v => typeof v === 'number') as number[];
    if (votes.length === 0) return '0';
    const sum = votes.reduce((acc, curr) => acc + curr, 0);
    return (sum / votes.length).toFixed(1);
  };

  // Handle a user selecting a card.
  const handleCardClick = (card: number) => {
    if (!isRevealed && isConnected && socketRef.current && roomId) {
      setSelectedCard(card);
      // Emit the vote to the backend.
      socketRef.current.emit('vote', { roomId, vote: card });
    }
  };

  // Handle a user joining a room.
  const handleJoin = () => {
    const currentRoomId = roomIdInputRef.current?.value;
    const currentPlayerName = playerNameInputRef.current?.value;

    if (socketRef.current && currentRoomId && currentPlayerName) {
      // Set the room ID to trigger the UI transition to the game board
      setRoomId(currentRoomId);
      setPlayerName(currentPlayerName);
      // Clear players and errors before joining
      setPlayers([]);
      setError('');
      // Emit the join event. The backend will send an update.
      socketRef.current.emit('join', { roomId: currentRoomId, playerName: currentPlayerName });
    } else {
      setError('Please enter a room ID and your name.');
    }
  };

  // Handle creating a new room.
  const handleCreateRoom = async () => {
    const currentPlayerName = playerNameInputRef.current?.value;
    const backendUrl = 'https://pythonpoker-production.up.railway.app';

    if (!currentPlayerName) {
      setError('Please enter your name before creating a room.');
      return;
    }
    try {
      const response = await fetch(`${backendUrl}/create_room`, {
        method: 'POST',
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      setRoomId(data.roomId);
      setPlayerName(currentPlayerName);
      // Clear players and automatically join the room after it is created
      setPlayers([]);
      if (socketRef.current) {
        socketRef.current.emit('join', { roomId: data.roomId, playerName: currentPlayerName });
        console.log(`Automatically joined room ${data.roomId} after creation.`);
      }
    } catch (err: unknown) {
      console.error('Failed to create room:', err);
      // Type guard for the unknown error type
      if (err instanceof Error) {
        setError(`Failed to connect to the backend: ${err.message}. Please ensure the Python server is running and accessible.`);
      } else {
        setError('An unknown error occurred while creating a room.');
      }
    }
  };

  return (
    <div className="bg-gray-900 min-h-screen flex flex-col items-center justify-center p-4 text-white font-sans antialiased">
      <div className="w-full max-w-4xl space-y-8">
        <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-center text-teal-400 drop-shadow-lg">
          Planning Poker
        </h1>

        {!roomId ? (
          // Join or create room form
          <div className="bg-gray-800 p-8 rounded-3xl shadow-xl border border-gray-700 space-y-4">
            <h2 className="text-center text-2xl font-semibold mb-4 text-gray-200">
              Join or Create a Room
            </h2>
            <input
              ref={playerNameInputRef}
              type="text"
              placeholder="Enter your name"
              className="w-full p-3 rounded-lg bg-gray-700 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
            <div className="flex space-x-2">
              <input
                ref={roomIdInputRef}
                type="text"
                placeholder="Enter Room ID"
                className="w-2/3 p-3 rounded-lg bg-gray-700 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
              <button
                onClick={handleJoin}
                className="w-1/3 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-lg transition-colors"
              >
                Join
              </button>
            </div>
            <div className="text-center text-gray-400">or</div>
            <button
              onClick={handleCreateRoom}
              className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-4 rounded-lg transition-colors"
            >
              Create New Room
            </button>
            {error && <p className="text-red-400 text-center mt-4">{error}</p>}
          </div>
        ) : (
          // Main game UI
          <>
            <p className="text-center text-gray-400">
              You are in room: <span className="font-mono font-bold text-teal-400">{roomId}</span>
            </p>

            {/* Connection Status Indicator */}
            <div className="flex items-center justify-center space-x-2 text-sm text-gray-400">
              <span className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}></span>
              <span>{isConnected ? 'Connected' : 'Disconnected'}</span>
            </div>

            {/* Player votes section */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 bg-gray-800 p-6 rounded-3xl shadow-xl border border-gray-700">
              {players.map(player => (
                <div key={player.id} className="text-center">
                  <p className="text-sm text-gray-400 mb-2">{player.name}</p>
                  <div
                    className={`flex items-center justify-center w-20 h-28 mx-auto text-3xl font-bold rounded-2xl shadow-inner
                               transition-all duration-300 transform
                               ${
                                 isRevealed && player.vote !== null ? 'bg-teal-500 text-white scale-110 rotate-3' :
                                 selectedCard !== null && player.name === playerName ? 'bg-gray-600 text-gray-300 scale-105' :
                                 'bg-gray-700 text-gray-500 hover:bg-gray-600'
                               }`}
                  >
                    {isRevealed && player.vote !== null ? player.vote : '?'}
                  </div>
                </div>
              ))}
            </div>

            {/* Card selection area */}
            <div className="bg-gray-800 p-6 rounded-3xl shadow-xl border border-gray-700">
              <h2 className="text-center text-xl font-semibold mb-6 text-gray-200">Select your vote</h2>
              <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-9 gap-4">
                {cards.map(card => (
                  <button
                    key={card}
                    onClick={() => handleCardClick(card)}
                    disabled={isRevealed || !isConnected}
                    className={`
                      bg-gray-700 hover:bg-teal-500 active:bg-teal-600 focus:outline-none focus:ring-4 focus:ring-teal-300
                      text-white font-bold text-2xl p-4 rounded-xl shadow-md transition-all duration-200 transform
                      hover:-translate-y-1 hover:scale-110
                      ${selectedCard === card && !isRevealed ? 'bg-teal-600 ring-4 ring-teal-300 scale-110' : ''}
                      ${isRevealed ? 'cursor-not-allowed opacity-50' : ''}
                    `}
                  >
                    {card}
                  </button>
                ))}
              </div>
            </div>

            {/* Action buttons and results */}
            <div className="flex flex-col sm:flex-row justify-center items-center space-y-4 sm:space-y-0 sm:space-x-4">
              <button
                onClick={() => socketRef.current?.emit('reveal', { roomId })}
                disabled={isRevealed || !isConnected}
                className="bg-blue-600 hover:bg-blue-700 active:bg-blue-800 focus:outline-none focus:ring-4 focus:ring-blue-300 text-white font-bold py-3 px-6 rounded-full shadow-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed w-full sm:w-auto"
              >
                Reveal Votes
              </button>
              <button
                onClick={() => socketRef.current?.emit('reset', { roomId })}
                className="bg-red-600 hover:bg-red-700 active:bg-red-800 focus:outline-none focus:ring-4 focus:ring-red-300 text-white font-bold py-3 px-6 rounded-full shadow-lg transition-all duration-200 w-full sm:w-auto"
              >
                Reset
              </button>
            </div>

            {/* Display average if votes are revealed */}
            {isRevealed && (
              <div className="text-center mt-8 bg-gray-800 p-6 rounded-3xl shadow-xl border border-gray-700">
                <h2 className="text-2xl font-bold text-gray-200">Average Estimate</h2>
                <p className="text-5xl font-extrabold text-yellow-400 mt-2">{calculateAverage()}</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default App;
