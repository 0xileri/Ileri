import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { del, get, patch, post } from '../../api';
import { useAuth } from '../../auth';
import { Avatar, ErrorNotice, Field, formatDate, Spinner, useToast } from '../../components/ui';
import { useManage } from './ManageRoutes';

interface Member {
  userId: string;
  displayName: string;
  role: 'owner' | 'instructor' | 'member';
  joinedAt: string;
}

interface Invite {
  id: string;
  role: string;
  note: string;
  maxUses: number;
  uses: number;
  expiresAt: string;
}

export function MembersPage() {
  const { community, isOwner } = useManage();
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [filter, setFilter] = useState('');
  const members = useQuery({ queryKey: ['members', community.id], queryFn: () => get<{ members: Member[] }>(`/api/communities/${community.id}/members`) });
  const invites = useQuery({
    queryKey: ['invites', community.id],
    enabled: isOwner,
    queryFn: () => get<{ invites: Invite[] }>(`/api/communities/${community.id}/invites`),
  });
  const changeRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) => patch(`/api/communities/${community.id}/members/${userId}`, { role }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['members', community.id] }),
  });
  const remove = useMutation({
    mutationFn: (userId: string) => del(`/api/communities/${community.id}/members/${userId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['members', community.id] }),
  });
  const [inviteRole, setInviteRole] = useState<'instructor' | 'owner'>('instructor');
  const [inviteNote, setInviteNote] = useState('');
  const [newLink, setNewLink] = useState<string | null>(null);
  const createInvite = useMutation({
    mutationFn: () => post<{ invite: { url: string } }>(`/api/communities/${community.id}/invites`, { role: inviteRole, note: inviteNote }),
    onSuccess: (data) => {
      setNewLink(data.invite.url);
      setInviteNote('');
      qc.invalidateQueries({ queryKey: ['invites', community.id] });
    },
  });
  const revokeInvite = useMutation({
    mutationFn: (id: string) => del(`/api/communities/${community.id}/invites/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invites', community.id] }),
  });
  const list = (members.data?.members ?? []).filter((m) => m.displayName.toLowerCase().includes(filter.toLowerCase()));
  return (
    <div className="stack">
      {isOwner && (
        <section className="card flat">
          <h3>Invite staff</h3>
          <p className="muted small">
            Members join through the community's access rules. Invitations are for instructors and co-owners, and work once unless you
            say otherwise.
          </p>
          <div className="form-grid">
            <Field label="Role" htmlFor="invite-role">
              <select id="invite-role" value={inviteRole} onChange={(e) => setInviteRole(e.target.value as 'instructor' | 'owner')}>
                <option value="instructor">Instructor (create courses, review work)</option>
                <option value="owner">Owner (everything, including rewards)</option>
              </select>
            </Field>
            <Field label="Note (optional)" htmlFor="invite-note">
              <input id="invite-note" value={inviteNote} onChange={(e) => setInviteNote(e.target.value)} />
            </Field>
          </div>
          <button className="btn" onClick={() => createInvite.mutate()} disabled={createInvite.isPending}>
            Create invite link
          </button>
          {newLink && (
            <div className="notice ok small" style={{ marginTop: 12 }}>
              <strong>Share this link. It is shown only once.</strong>
              <div className="row">
                <span className="mono spacer">{newLink}</span>
                <button
                  className="btn small"
                  onClick={() => navigator.clipboard.writeText(newLink).then(() => toast('Invite link copied.'), () => {})}
                >
                  Copy
                </button>
              </div>
            </div>
          )}
          {createInvite.error && <ErrorNotice error={createInvite.error} />}
          {(invites.data?.invites.length ?? 0) > 0 && (
            <ul className="small" style={{ marginTop: 14 }}>
              {invites.data!.invites.map((i) => (
                <li key={i.id}>
                  {i.role} invite {i.note && `("${i.note}") `}· {i.uses}/{i.maxUses} used · expires {formatDate(i.expiresAt)}{' '}
                  <button className="link-button" onClick={() => revokeInvite.mutate(i.id)}>
                    revoke
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section>
        <div className="row between">
          <h3 style={{ margin: 0 }}>{members.data?.members.length ?? 0} members</h3>
          <input type="search" placeholder="Filter by name" aria-label="Filter members" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ maxWidth: 240 }} />
        </div>
        {members.isLoading && <Spinner />}
        {members.error && <ErrorNotice error={members.error} />}
        {(changeRole.error || remove.error) && <ErrorNotice error={changeRole.error ?? remove.error} />}
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Joined</th>
                <th>Role</th>
                {isOwner && <th />}
              </tr>
            </thead>
            <tbody>
              {list.map((m) => (
                <tr key={m.userId}>
                  <td>
                    <div className="row" style={{ gap: 8 }}>
                      <Avatar name={m.displayName} />
                      {m.displayName}
                      {m.userId === user?.id && <span className="tiny muted">(you)</span>}
                    </div>
                  </td>
                  <td className="small">{formatDate(m.joinedAt)}</td>
                  <td>
                    {isOwner ? (
                      <select
                        aria-label={`Role for ${m.displayName}`}
                        value={m.role}
                        onChange={(e) => changeRole.mutate({ userId: m.userId, role: e.target.value })}
                        style={{ width: 'auto', minHeight: 34, padding: '4px 8px' }}
                      >
                        <option value="member">Member</option>
                        <option value="instructor">Instructor</option>
                        <option value="owner">Owner</option>
                      </select>
                    ) : (
                      <span className="badge">{m.role}</span>
                    )}
                  </td>
                  {isOwner && (
                    <td>
                      {m.userId !== user?.id && (
                        <button
                          className="btn small danger"
                          onClick={() => confirm(`Remove ${m.displayName}? They keep earned credentials but lose access.`) && remove.mutate(m.userId)}
                        >
                          Remove
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
