import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

interface User {
  username: string;
  position: number | null; // Menggunakan nomor kotak (0-7)
  score: number;
  alive: boolean;
}

@WebSocketGateway({
  cors: {
    origin: '*', // Sesuaikan dengan frontend Anda
  },
})
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private users: Record<string, User> = {};

  private timer: NodeJS.Timeout | null = null;
  private countdown: number = 20; // detik
  private gameInterval: NodeJS.Timeout | null = null;

  private readonly TOTAL_BOXES = 4;

  handleConnection(client: Socket) {
    console.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    console.log(`Client disconnected: ${client.id}`);
    delete this.users[client.id];
    this.server.emit('roomUpdate', this.users);
  }

  @SubscribeMessage('joinGame')
  handleJoinGame(
    @MessageBody() { username }: { username: string },
    @ConnectedSocket() client: Socket,
  ) {
    if (Object.keys(this.users).length >= 10) {
      client.emit('error', { message: 'Room penuh' });
      return;
    }

    this.users[client.id] = {
      username,
      position: null,
      score: 0,
      alive: true,
    };

    this.server.emit('roomUpdate', this.users);

    // Jika ini adalah pemain pertama, mulai timer
    if (Object.keys(this.users).length === 1 && !this.gameInterval) {
      this.startGameLoop();
    }
  }

  @SubscribeMessage('selectBox')
  handleSelectBox(
    @MessageBody() { boxIndex }: { boxIndex: number },
    @ConnectedSocket() client: Socket,
  ) {
    const user = this.users[client.id];
    if (!user) return;

    // Hanya bisa memilih kotak jika lebih dari 3 detik tersisa
    if (this.countdown > 3) {
      if (boxIndex < 0 || boxIndex >= this.TOTAL_BOXES) return;
      user.position = boxIndex;
      this.server.emit('roomUpdate', this.users);
    }
  }

  private startGameLoop() {
    // Kirim initial countdown
    this.server.emit('timer', this.countdown);

    this.gameInterval = setInterval(() => {
      this.countdown--;

      if (this.countdown > 0) {
        this.server.emit('timer', this.countdown);
      }

      if (this.countdown === 1) {
        this.handleElimination();
      }

      if (this.countdown <= 0) {
        // Reset game
        this.resetGame();
      }
    }, 1000);
  }

  private handleElimination() {
    // Pilih kotak secara acak
    const randomBox = Math.floor(Math.random() * this.TOTAL_BOXES);
    this.server.emit('elimination', { boxIndex: randomBox });

    // Proses eliminasi
    Object.values(this.users).forEach((user) => {
      if (user.position === randomBox && user.alive) {
        user.alive = false;
        user.score -= 10;
      } else if (user.position != null && user.alive) {
        user.score += 10;
      }
    });

    this.server.emit('roomUpdate', this.users);
  }

  private resetGame() {
    // Reset posisi dan status hidup semua pemain
    Object.values(this.users).forEach((user) => {
      user.position = null;
      user.alive = true;
    });

    this.server.emit('roomUpdate', this.users);

    // Reset countdown
    this.countdown = 20;
    this.server.emit('timer', this.countdown);
  }
}
