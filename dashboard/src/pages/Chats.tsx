import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Send, Loader2, User, Users, AlertCircle, MessageSquare, Paperclip, Smile, X, CornerUpLeft, Trash2 } from 'lucide-react';
import { sessionApi, messageApi, type Session, type Chat } from '../services/api';
import { useWebSocket } from '../hooks/useWebSocket';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useRole } from '../hooks/useRole';
import { PageHeader } from '../components/PageHeader';
import './Chats.css';

interface Message {
  id: string;
  waMessageId?: string;
  chatId: string;
  from: string;
  to: string;
  body: string;
  type: string;
  direction: 'incoming' | 'outgoing';
  status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
  timestamp?: number;
  createdAt: string;
  metadata?: {
    media?: {
      mimetype: string;
      filename?: string;
      data?: string;
    };
    quotedMessage?: {
      id: string;
      body: string;
    };
    reactions?: Record<string, string>;
  };
}

const getMediaSrc = (media: { mimetype: string; data?: string }) => {
  if (!media || !media.data) return '';
  if (media.data.startsWith('data:') || media.data.startsWith('http://') || media.data.startsWith('https://')) {
    return media.data;
  }
  return `data:${media.mimetype};base64,${media.data}`;
};

export function Chats() {
  const { t } = useTranslation();
  useDocumentTitle(t('nav.chats'));
  const { canWrite } = useRole();

  // Sessions list & active session
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const [loadingSessions, setLoadingSessions] = useState<boolean>(true);

  // Chats list
  const [chats, setChats] = useState<Chat[]>([]);
  const [loadingChats, setLoadingChats] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Selected Chat & Message History
  const [activeChat, setActiveChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingMessages, setLoadingMessages] = useState<boolean>(false);
  const [messageInput, setMessageInput] = useState<string>('');
  const [sending, setSending] = useState<boolean>(false);

  // File Attachments
  const [attachment, setAttachment] = useState<{ file: File; base64: string; mimetype: string; filename: string } | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState<boolean>(false);

  // References
  const chatBottomRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);

  // Popular Emojis
  const popularEmojis = ['😀', '😂', '👍', '❤️', '🔥', '👏', '🙏', '🎉', '💡', '🤔', '😅', '😍', '😊', '😭', '😎', '😜', '🚀', '✨'];

  // 1. Fetch available connected sessions on mount
  useEffect(() => {
    const loadSessions = async () => {
      try {
        setLoadingSessions(true);
        const list = await sessionApi.list();
        const readySessions = list.filter(s => s.status === 'ready');
        setSessions(readySessions);
        if (readySessions.length > 0) {
          setSelectedSessionId(readySessions[0].id);
        }
      } catch (err) {
        console.error('Failed to load sessions:', err);
      } finally {
        setLoadingSessions(false);
      }
    };
    void loadSessions();
  }, []);

  // 2. Fetch chats when active session changes
  const loadChats = useCallback(async (sessionId: string) => {
    if (!sessionId) return;
    try {
      setLoadingChats(true);
      const data = await sessionApi.getChats(sessionId);
      const sorted = [...data].sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return (b.timestamp || 0) - (a.timestamp || 0);
      });
      setChats(sorted);
    } catch (err) {
      console.error('Failed to load chats:', err);
      setChats([]);
    } finally {
      setLoadingChats(false);
    }
  }, []);

  useEffect(() => {
    if (selectedSessionId) {
      void loadChats(selectedSessionId);
      setActiveChat(null);
      setMessages([]);
      setAttachment(null);
      setPreviewUrl(null);
    }
  }, [selectedSessionId, loadChats]);

  // 3. WebSocket Integration for real-time messages
  const handleIncomingMessage = useCallback(
    (event: { sessionId: string; message: any }) => {
      if (event.sessionId !== selectedSessionId) return;

      const newMsg = event.message;

      // Update message list if the message belongs to the currently active chat
      if (activeChat && newMsg.chatId === activeChat.id) {
        // Mark as read/seen in backend
        void fetch(`/api/sessions/${selectedSessionId}/chats/read`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': sessionStorage.getItem('openwa_api_key') || '',
          },
          body: JSON.stringify({ chatId: activeChat.id }),
        }).catch(err => console.error('Failed to mark incoming chat as read:', err));

        const mappedMessage: Message = {
          id: newMsg.id,
          waMessageId: newMsg.id,
          chatId: newMsg.chatId,
          from: newMsg.from,
          to: newMsg.to,
          body: newMsg.body,
          type: newMsg.type,
          direction: newMsg.fromMe ? 'outgoing' : 'incoming',
          status: 'sent',
          timestamp: newMsg.timestamp,
          createdAt: new Date(newMsg.timestamp * 1000).toISOString(),
          metadata: newMsg.metadata || {
            media: newMsg.media,
            quotedMessage: newMsg.quotedMessage,
          },
        };

        setMessages(prev => {
          if (prev.some(m => m.id === mappedMessage.id || m.waMessageId === mappedMessage.id)) {
            return prev;
          }
          return [...prev, mappedMessage];
        });
      }

      // Update sidebar chat list
      setChats(prevChats => {
        const chatIndex = prevChats.findIndex(c => c.id === newMsg.chatId);
        const updatedLastMessage = {
          id: newMsg.id,
          body: newMsg.body,
          type: newMsg.type,
          timestamp: newMsg.timestamp,
          fromMe: newMsg.fromMe,
        };

        if (chatIndex > -1) {
          const updatedChats = [...prevChats];
          const targetChat = { ...updatedChats[chatIndex] };

          targetChat.lastMessage = updatedLastMessage;
          targetChat.timestamp = newMsg.timestamp;

          if (!newMsg.fromMe && (!activeChat || activeChat.id !== targetChat.id)) {
            targetChat.unreadCount = (targetChat.unreadCount || 0) + 1;
          }

          updatedChats.splice(chatIndex, 1);

          let insertIndex = 0;
          if (!targetChat.pinned) {
            insertIndex = updatedChats.findIndex(c => !c.pinned);
            if (insertIndex === -1) insertIndex = updatedChats.length;
          }

          updatedChats.splice(insertIndex, 0, targetChat);
          return updatedChats;
        } else {
          void loadChats(selectedSessionId);
          return prevChats;
        }
      });
    },
    [selectedSessionId, activeChat, loadChats],
  );

  const handleIncomingMessageAck = useCallback(
    (event: { sessionId: string; messageId: string; ack: number; ackName: string; chatId?: string }) => {
      if (event.sessionId !== selectedSessionId) return;

      // Update message status in the UI
      setMessages(prev =>
        prev.map(msg => {
          if (msg.id === event.messageId || msg.waMessageId === event.messageId) {
            const statusMap: Record<number, Message['status']> = {
              [-1]: 'failed',
              [0]: 'pending',
              [1]: 'sent',
              [2]: 'delivered',
              [3]: 'read',
              [4]: 'read',
            };
            return { ...msg, status: statusMap[event.ack] || msg.status };
          }
          return msg;
        })
      );
    },
    [selectedSessionId]
  );

  const handleIncomingMessageReaction = useCallback(
    (event: { sessionId: string; messageId: string; chatId: string; reaction: string; senderId: string; reactions: Record<string, string> }) => {
      if (event.sessionId !== selectedSessionId) return;

      setMessages(prev =>
        prev.map(msg => {
          if (msg.id === event.messageId || msg.waMessageId === event.messageId) {
            const metadata = msg.metadata || {};
            return {
              ...msg,
              metadata: {
                ...metadata,
                reactions: event.reactions,
              },
            };
          }
          return msg;
        })
      );
    },
    [selectedSessionId]
  );

  const handleIncomingMessageRevoked = useCallback(
    (event: { sessionId: string; id: string; chatId: string; from: string; to: string; body: string; type: string }) => {
      if (event.sessionId !== selectedSessionId) return;

      setMessages(prev =>
        prev.map(msg => {
          if (msg.id === event.id || msg.waMessageId === event.id) {
            return {
              ...msg,
              body: event.body,
              type: event.type,
            };
          }
          return msg;
        })
      );
    },
    [selectedSessionId]
  );

  const { subscribe, unsubscribe } = useWebSocket({
    onMessage: handleIncomingMessage,
    onMessageAck: handleIncomingMessageAck,
    onMessageReaction: handleIncomingMessageReaction,
    onMessageRevoked: handleIncomingMessageRevoked,
  });

  useEffect(() => {
    if (selectedSessionId) {
      subscribe(selectedSessionId, ['message.received', 'message.sent', 'message.ack', 'message.reaction', 'message.revoked']);
      return () => {
        unsubscribe(selectedSessionId);
      };
    }
  }, [selectedSessionId, subscribe, unsubscribe]);

  // 4. Fetch Message History for selected Chat
  const loadMessages = useCallback(
    async (chatId: string) => {
      if (!selectedSessionId || !chatId) return;
      try {
        setLoadingMessages(true);
        // Mark chat as read/seen in backend
        void fetch(`/api/sessions/${selectedSessionId}/chats/read`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': sessionStorage.getItem('openwa_api_key') || '',
          },
          body: JSON.stringify({ chatId }),
        }).catch(err => console.error('Failed to mark chat as read:', err));

        const response = await fetch(
          `/api/sessions/${selectedSessionId}/messages?chatId=${encodeURIComponent(chatId)}&limit=100`,
          {
            headers: {
              'X-API-Key': sessionStorage.getItem('openwa_api_key') || '',
            },
          },
        );
        if (response.ok) {
          const data = await response.json();
          const reversed = [...data.messages].reverse();
          setMessages(reversed);
        } else {
          setMessages([]);
        }
      } catch (err) {
        console.error('Failed to load messages:', err);
        setMessages([]);
      } finally {
        setLoadingMessages(false);
      }
    },
    [selectedSessionId],
  );

  const handleReactMessage = async (msg: Message, emoji: string) => {
    if (!selectedSessionId || !activeChat) return;

    const msgId = msg.waMessageId || msg.id;
    const currentReactions = msg.metadata?.reactions || {};
    const sessionPhone = sessions.find(s => s.id === selectedSessionId)?.phone || 'me';

    let alreadyReacted = false;
    for (const [sender, emo] of Object.entries(currentReactions)) {
      if ((sender === 'me' || sender.includes(sessionPhone)) && emo === emoji) {
        alreadyReacted = true;
        break;
      }
    }

    const emojiToSend = alreadyReacted ? '' : emoji;

    try {
      await messageApi.react(selectedSessionId, {
        chatId: activeChat.id,
        messageId: msgId,
        emoji: emojiToSend,
      });

      setMessages(prev =>
        prev.map(m => {
          if (m.id === msg.id || m.waMessageId === msg.id) {
            const metadata = m.metadata || {};
            const reactions = { ...(metadata.reactions as Record<string, string> || {}) };
            if (emojiToSend === '') {
              delete reactions['me'];
            } else {
              reactions['me'] = emojiToSend;
            }
            return { ...m, metadata: { ...metadata, reactions } };
          }
          return m;
        })
      );
    } catch (err) {
      console.error('Failed to react to message:', err);
    }
  };

  const handleDeleteMessage = async (msg: Message) => {
    if (!selectedSessionId || !activeChat) return;
    const msgId = msg.waMessageId || msg.id;

    if (!window.confirm('Tarik pesan ini untuk semua orang?')) return;

    try {
      await messageApi.delete(selectedSessionId, {
        chatId: activeChat.id,
        messageId: msgId,
        forEveryone: true,
      });

      setMessages(prev =>
        prev.map(m => {
          if (m.id === msg.id || m.waMessageId === msg.id) {
            return { ...m, body: '🚫 Pesan ini telah dihapus', type: 'revoked' };
          }
          return m;
        })
      );
    } catch (err) {
      console.error('Failed to delete message:', err);
    }
  };

  useEffect(() => {
    if (activeChat) {
      void loadMessages(activeChat.id);
      setChats(prev =>
        prev.map(c => (c.id === activeChat.id ? { ...c, unreadCount: 0 } : c)),
      );
    } else {
      setMessages([]);
    }
  }, [activeChat, loadMessages]);

  // 5. Scroll chat to bottom
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 6. Handle File selection & Base64 conversion
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Set preview URL for images
    if (file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
    } else {
      setPreviewUrl(null);
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      const base64Data = dataUrl.split(',')[1];
      setAttachment({
        file,
        base64: base64Data,
        mimetype: file.type,
        filename: file.name,
      });
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveAttachment = () => {
    setAttachment(null);
    setPreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const triggerFileSelect = () => {
    fileInputRef.current?.click();
  };

  const handleEmojiClick = (emoji: string) => {
    setMessageInput(prev => prev + emoji);
    setShowEmojiPicker(false);
  };

  // 7. Handle sending message / media
  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!selectedSessionId || !activeChat || sending) return;

    const textToSend = messageInput.trim();

    // Check if we are sending text or media
    if (!textToSend && !attachment) return;

    setMessageInput('');
    setSending(true);

    const tempId = `temp_${Date.now()}`;
    
    // Create temporary bubble message
    const tempMessage: Message = {
      id: tempId,
      chatId: activeChat.id,
      from: 'me',
      to: activeChat.id,
      body: attachment ? (attachment.mimetype.startsWith('image/') || attachment.mimetype.startsWith('video/') || attachment.mimetype.startsWith('audio/') ? textToSend : attachment.filename) : textToSend,
      type: attachment ? attachment.mimetype.split('/')[0] : 'text',
      direction: 'outgoing',
      status: 'pending',
      createdAt: new Date().toISOString(),
      metadata: attachment ? {
        media: {
          mimetype: attachment.mimetype,
          filename: attachment.filename,
          data: attachment.base64,
        }
      } : (replyingTo ? {
        quotedMessage: {
          id: replyingTo.waMessageId || replyingTo.id,
          body: replyingTo.type !== 'text' ? `[${replyingTo.type}]` : replyingTo.body,
        }
      } : undefined),
    };

    setMessages(prev => [...prev, tempMessage]);

    // Store local attachment & reply states
    const currentAttachment = attachment;
    const currentReplyingTo = replyingTo;
    handleRemoveAttachment();
    setReplyingTo(null);

    try {
      let result;

      if (currentAttachment) {
        // Determine backend category
        let mediaType: 'image' | 'video' | 'audio' | 'document' = 'document';
        const mime = currentAttachment.mimetype;
        if (mime.startsWith('image/')) mediaType = 'image';
        else if (mime.startsWith('video/')) mediaType = 'video';
        else if (mime.startsWith('audio/')) mediaType = 'audio';

        result = await messageApi.sendMedia(selectedSessionId, activeChat.id, mediaType, {
          base64: currentAttachment.base64,
          mimetype: currentAttachment.mimetype,
          filename: currentAttachment.filename,
          caption: mediaType !== 'audio' ? textToSend : undefined,
        });
      } else if (currentReplyingTo) {
        result = await messageApi.reply(selectedSessionId, {
          chatId: activeChat.id,
          quotedMessageId: currentReplyingTo.waMessageId || currentReplyingTo.id,
          text: textToSend,
        });
      } else {
        result = await messageApi.sendText(selectedSessionId, activeChat.id, textToSend);
      }

      setMessages(prev =>
        prev.map(m =>
          m.id === tempId
            ? { ...m, id: result.messageId, waMessageId: result.messageId, status: 'sent' }
            : m,
        ),
      );

      // Update sidebar chat list
      setChats(prevChats => {
        const chatIndex = prevChats.findIndex(c => c.id === activeChat.id);
        if (chatIndex > -1) {
          const updatedChats = [...prevChats];
          const target = { ...updatedChats[chatIndex] };
          target.lastMessage = {
            id: result.messageId,
            body: currentAttachment ? `[${currentAttachment.mimetype.split('/')[0]}]` : textToSend,
            type: currentAttachment ? currentAttachment.mimetype.split('/')[0] : 'text',
            timestamp: Math.floor(Date.now() / 1000),
            fromMe: true,
          };
          target.timestamp = Math.floor(Date.now() / 1000);

          updatedChats.splice(chatIndex, 1);
          let insertIndex = 0;
          if (!target.pinned) {
            insertIndex = updatedChats.findIndex(c => !c.pinned);
            if (insertIndex === -1) insertIndex = updatedChats.length;
          }
          updatedChats.splice(insertIndex, 0, target);
          return updatedChats;
        }
        return prevChats;
      });
    } catch (err) {
      console.error('Failed to send message:', err);
      setMessages(prev =>
        prev.map(m => (m.id === tempId ? { ...m, status: 'failed' } : m)),
      );
    } finally {
      setSending(false);
    }
  };

  // Helper formats
  const formatTime = (timestamp?: number) => {
    if (!timestamp) return '';
    const date = new Date(timestamp * 1000);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatLastMessageSnippet = (chat: Chat) => {
    if (!chat.lastMessage) return '';
    const prefix = chat.lastMessage.fromMe ? 'You: ' : '';
    if (chat.lastMessage.type !== 'text') {
      return `${prefix}[${chat.lastMessage.type}]`;
    }
    return `${prefix}${chat.lastMessage.body}`;
  };

  const formatChatTime = (timestamp?: number) => {
    if (!timestamp) return '';
    const date = new Date(timestamp * 1000);
    const today = new Date();
    if (date.toDateString() === today.toDateString()) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) {
      return 'Yesterday';
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const filteredChats = chats.filter(
    c =>
      c.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.id.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  return (
    <div className="chats-page">
      <PageHeader title={t('nav.chats')} subtitle="Kirim dan balas pesan WhatsApp secara real-time" />

      {loadingSessions ? (
        <div className="chats-loading-container">
          <Loader2 className="animate-spin" size={32} />
          <p>{t('common.loading')}</p>
        </div>
      ) : sessions.length === 0 ? (
        <div className="chats-error-state">
          <AlertCircle size={48} className="text-warn" />
          <h3>Tidak ada sesi terhubung</h3>
          <p>Silakan hubungkan/koneksikan sesi WhatsApp Anda di menu <strong>Sessions</strong> terlebih dahulu agar dapat menggunakan fitur chat.</p>
        </div>
      ) : (
        <div className="chats-layout">
          {/* LEFT SIDEBAR: Session & Chat Rooms */}
          <aside className="chats-sidebar">
            <div className="sidebar-header-box">
              {/* Session Selector */}
              <div className="session-select-group">
                <label className="form-label">Sesi WhatsApp</label>
                <select
                  value={selectedSessionId}
                  onChange={e => setSelectedSessionId(e.target.value)}
                  className="session-selector"
                >
                  {sessions.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.phone || 'No phone'})
                    </option>
                  ))}
                </select>
              </div>

              {/* Search Bar */}
              <div className="chat-search-input">
                <Search size={18} />
                <input
                  type="text"
                  placeholder="Cari obrolan..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                />
              </div>
            </div>

            {/* Chat List */}
            <div className="chats-list">
              {loadingChats ? (
                <div className="chats-list-loading">
                  <Loader2 className="animate-spin" size={24} />
                  <span>Loading chats...</span>
                </div>
              ) : filteredChats.length === 0 ? (
                <div className="chats-list-empty">
                  <span>Tidak ada obrolan</span>
                </div>
              ) : (
                filteredChats.map(chat => {
                  const isActive = activeChat?.id === chat.id;
                  return (
                    <div
                      key={chat.id}
                      className={`chat-item-card ${isActive ? 'active' : ''} ${chat.pinned ? 'pinned' : ''}`}
                      onClick={() => setActiveChat(chat)}
                    >
                      <div className="chat-avatar">
                        {chat.isGroup ? <Users size={20} /> : <User size={20} />}
                      </div>

                      <div className="chat-item-info">
                        <div className="chat-item-top">
                          <span className="chat-item-name" title={chat.name || chat.id}>
                            {chat.name || chat.id.split('@')[0]}
                          </span>
                          {chat.timestamp && (
                            <span className="chat-item-time">{formatChatTime(chat.timestamp)}</span>
                          )}
                        </div>
                        <div className="chat-item-bottom">
                          <span className="chat-item-snippet" title={formatLastMessageSnippet(chat)}>
                            {formatLastMessageSnippet(chat) || <span className="no-message">Belum ada pesan</span>}
                          </span>
                          {chat.unreadCount > 0 && (
                            <span className="chat-unread-badge">{chat.unreadCount}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </aside>

          {/* RIGHT VIEW: Active Chat Room */}
          <main className="chats-room">
            {activeChat ? (
              <div className="room-container">
                {/* Room Header */}
                <header className="room-header">
                  <div className="room-avatar">
                    {activeChat.isGroup ? <Users size={20} /> : <User size={20} />}
                  </div>
                  <div className="room-contact-info">
                    <h3>{activeChat.name || activeChat.id.split('@')[0]}</h3>
                    <span>{activeChat.id}</span>
                  </div>
                </header>

                {/* Messages Body */}
                <div className="room-messages">
                  {loadingMessages ? (
                    <div className="messages-loading">
                      <Loader2 className="animate-spin" size={32} />
                      <span>Loading messages...</span>
                    </div>
                  ) : messages.length === 0 ? (
                    <div className="messages-empty">
                      <MessageSquare size={32} />
                      <span>Belum ada pesan. Kirim pesan pertama untuk memulai!</span>
                    </div>
                  ) : (
                    messages.map(msg => {
                      const isMe = msg.direction === 'outgoing';
                      const formattedTime = formatTime(msg.timestamp || Math.floor(new Date(msg.createdAt).getTime() / 1000));
                      
                      // Highlight media messages differently if desired
                      const isMediaMessage = msg.type !== 'text';
                      
                      const mediaInfo = msg.metadata?.media || (msg as any).media;

                      const renderMedia = () => {
                        if (msg.type === 'revoked') return null;
                        if (!mediaInfo) return null;
                        const mediaSrc = getMediaSrc(mediaInfo);
                        if (!mediaSrc) return null;

                        switch (msg.type) {
                          case 'image':
                          case 'sticker':
                            return (
                              <div className="message-media-image">
                                <img src={mediaSrc} alt={mediaInfo.filename || 'WhatsApp Image'} className="chat-image-media" />
                              </div>
                            );
                          case 'video':
                            return (
                              <div className="message-media-video">
                                <video src={mediaSrc} controls className="chat-video-media" />
                              </div>
                            );
                          case 'audio':
                          case 'voice':
                          case 'ptt':
                            return (
                              <div className="message-media-audio">
                                <audio src={mediaSrc} controls className="chat-audio-media" />
                              </div>
                            );
                          case 'document':
                          default:
                            return (
                              <div className="message-media-document">
                                <a href={mediaSrc} download={mediaInfo.filename || 'document'} className="chat-document-media">
                                  📎 {mediaInfo.filename || 'Unduh Dokumen'}
                                </a>
                              </div>
                            );
                        }
                      };

                      const reactions = msg.metadata?.reactions || {};
                      const hasReactions = Object.keys(reactions).length > 0;

                      return (
                        <div key={msg.id} className={`message-bubble-wrapper ${isMe ? 'outgoing' : 'incoming'}`}>
                          <div className="message-bubble-container">
                            <div className={`message-bubble ${isMe ? 'outgoing' : 'incoming'} ${msg.status} ${isMediaMessage ? 'media-type' : ''} ${msg.type === 'revoked' ? 'revoked-type' : ''}`}>
                              {/* Quoted message display */}
                              {msg.metadata?.quotedMessage && (
                                <div className="message-quote-box">
                                  <div className="quote-body">
                                    {msg.metadata.quotedMessage.body}
                                  </div>
                                </div>
                              )}

                              {renderMedia()}
                              
                              {msg.body && (!mediaInfo || msg.body !== mediaInfo.filename) && (
                                <div className="message-text">{msg.body}</div>
                              )}

                              <div className="message-meta">
                                <span className="message-time">{formattedTime}</span>
                                {isMe && (
                                  <span className={`message-status-icon ${msg.status}`}>
                                    {msg.status === 'pending' && '🕒'}
                                    {msg.status === 'sent' && '✓'}
                                    {msg.status === 'delivered' && '✓✓'}
                                    {msg.status === 'read' && '✓✓'}
                                    {msg.status === 'failed' && '⚠️'}
                                  </span>
                                )}
                              </div>

                              {/* Reactions display */}
                              {hasReactions && (
                                <div className="message-reactions-badge">
                                  {Object.values(reactions).slice(0, 3).map((emoji, idx) => (
                                    <span key={idx} className="reaction-emoji-span">{emoji as string}</span>
                                  ))}
                                  {Object.keys(reactions).length > 1 && (
                                    <span className="reactions-count-span">{Object.keys(reactions).length}</span>
                                  )}
                                </div>
                              )}
                            </div>

                            {/* Message actions menu (hover) */}
                            {msg.type !== 'revoked' && (
                              <div className="message-actions-menu">
                                <button type="button" className="action-btn" onClick={() => setReplyingTo(msg)} title="Balas">
                                  <CornerUpLeft size={14} />
                                </button>
                                
                                <div className="reaction-trigger-wrapper">
                                  <button type="button" className="action-btn reaction-btn" title="Reaksi">
                                    <Smile size={14} />
                                  </button>
                                  <div className="reaction-quick-popover">
                                    {['👍', '❤️', '😂', '😮', '😢', '🙏'].map(emoji => (
                                      <button key={emoji} type="button" onClick={() => handleReactMessage(msg, emoji)}>
                                        {emoji}
                                      </button>
                                    ))}
                                  </div>
                                </div>

                                {isMe && msg.status !== 'pending' && (
                                  <button type="button" className="action-btn delete-btn" onClick={() => handleDeleteMessage(msg)} title="Tarik Pesan">
                                    <Trash2 size={14} />
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div ref={chatBottomRef} />
                </div>

                {/* Attachment Preview Banner */}
                {attachment && (
                  <div className="attachment-preview-banner">
                    {previewUrl ? (
                      <img src={previewUrl} alt="Preview" className="preview-thumbnail" />
                    ) : (
                      <div className="preview-file-icon">📎</div>
                    )}
                    <div className="preview-file-info">
                      <span className="preview-filename">{attachment.filename}</span>
                      <span className="preview-filesize">({(attachment.file.size / 1024).toFixed(1)} KB)</span>
                    </div>
                    <button className="btn-remove-attachment" onClick={handleRemoveAttachment}>
                      <X size={18} />
                    </button>
                  </div>
                )}

                {/* Popular Emojis panel */}
                {showEmojiPicker && (
                  <div className="chats-emoji-picker">
                    <div className="emoji-grid">
                      {popularEmojis.map(emoji => (
                        <button
                          key={emoji}
                          type="button"
                          className="emoji-btn"
                          onClick={() => handleEmojiClick(emoji)}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Replying preview banner */}
                {replyingTo && (
                  <div className="replying-preview-banner">
                    <div className="replying-preview-content">
                      <div className="replying-to-title">
                        Membalas ke {replyingTo.direction === 'outgoing' ? 'Anda' : (activeChat.name || activeChat.id.split('@')[0])}
                      </div>
                      <div className="replying-to-body">
                        {replyingTo.type !== 'text' ? `[${replyingTo.type}]` : replyingTo.body}
                      </div>
                    </div>
                    <button className="btn-close-reply" onClick={() => setReplyingTo(null)}>
                      <X size={18} />
                    </button>
                  </div>
                )}

                {/* Message Input bar */}
                <footer className="room-input-footer">
                  <form onSubmit={handleSend} className="input-form">
                    {/* File Input */}
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleFileChange}
                      style={{ display: 'none' }}
                    />
                    
                    {/* Attachment Button */}
                    <button
                      type="button"
                      onClick={triggerFileSelect}
                      disabled={!canWrite || sending}
                      className="btn-input-accessory"
                      title="Kirim File/Gambar"
                    >
                      <Paperclip size={20} />
                    </button>

                    {/* Emoji Button */}
                    <button
                      type="button"
                      onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                      disabled={!canWrite || sending}
                      className={`btn-input-accessory ${showEmojiPicker ? 'active' : ''}`}
                      title="Pilih Emoji"
                    >
                      <Smile size={20} />
                    </button>

                    <input
                      type="text"
                      placeholder={
                        canWrite 
                          ? (attachment ? "Tambahkan keterangan (caption)..." : "Ketik pesan...") 
                          : "Anda tidak memiliki izin mengirim pesan"
                      }
                      value={messageInput}
                      onChange={e => setMessageInput(e.target.value)}
                      disabled={!canWrite || sending}
                      className="message-text-input"
                    />
                    <button
                      type="submit"
                      disabled={!canWrite || (!messageInput.trim() && !attachment) || sending}
                      className="btn-send-message"
                      aria-label="Kirim"
                    >
                      {sending ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />}
                    </button>
                  </form>
                </footer>
              </div>
            ) : (
              <div className="chats-room-placeholder">
                <MessageSquare size={80} className="placeholder-icon" />
                <h2>Mulai Mengirim Pesan</h2>
                <p>Pilih salah satu obrolan aktif dari sidebar kiri untuk mulai membaca dan mengirim pesan WhatsApp.</p>
              </div>
            )}
          </main>
        </div>
      )}
    </div>
  );
}
