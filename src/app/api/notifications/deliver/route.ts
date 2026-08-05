import { NextRequest, NextResponse } from 'next/server';
import { dbGetOne, dbGetAll, dbRun, Notification, db_helpers } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { logger } from '@/lib/logger';

/**
 * POST /api/notifications/deliver - Notification delivery daemon endpoint
 *
 * Polls undelivered notifications and sends them to agents
 * via gateway agent command
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await request.json();
    const workspaceId = auth.user.workspace_id ?? 1;
    const {
      agent_filter, // Optional: only deliver to specific agent
      limit = 50,   // Max notifications to process per call
      dry_run = false // Test mode - don't actually deliver
    } = body;

    // Get undelivered notifications
    let query = `
      SELECT n.*, a.session_key
      FROM notifications n
      LEFT JOIN agents a ON n.recipient = a.name AND a.workspace_id = n.workspace_id
      WHERE n.delivered_at IS NULL AND n.workspace_id = ?
    `;

    const params: any[] = [workspaceId];

    if (agent_filter) {
      query += ' AND n.recipient = ?';
      params.push(agent_filter);
    }

    query += ' ORDER BY n.created_at ASC LIMIT ?';
    params.push(limit);

    const undeliveredNotifications = await dbGetAll<Notification & { session_key?: string }>(query, params);

    if (undeliveredNotifications.length === 0) {
      return NextResponse.json({
        status: 'success',
        message: 'No undelivered notifications found',
        processed: 0,
        delivered: 0,
        errors: []
      });
    }

    let deliveredCount = 0;
    let errorCount = 0;
    const errors: any[] = [];
    const deliveryResults: any[] = [];

    for (const notification of undeliveredNotifications) {
      try {
        // Skip if agent is not registered in the agents table
        if (!notification.recipient) {
          errors.push({
            notification_id: notification.id,
            recipient: notification.recipient,
            error: 'Notification has no recipient'
          });
          errorCount++;
          continue;
        }

        // Format message for delivery
        const message = formatNotificationMessage(notification);

        if (!dry_run) {
          // Gateway CLI delivery is not available; mark notification as skipped
          deliveryResults.push({
            notification_id: notification.id,
            recipient: notification.recipient,
            session_key: notification.session_key,
            status: 'skipped',
            note: 'gateway_rpc_unavailable',
          });
        } else {
          // Dry run - just log what would be sent
          deliveryResults.push({
            notification_id: notification.id,
            recipient: notification.recipient,
            session_key: notification.session_key,
            status: 'dry_run',
            message: message
          });
          deliveredCount++;
        }
      } catch (error: any) {
        errorCount++;
        errors.push({
          notification_id: notification.id,
          recipient: notification.recipient,
          error: error.message
        });

        logger.error({ err: error, notificationId: notification.id, recipient: notification.recipient }, 'Failed to deliver notification');
      }
    }

    // Log delivery batch summary
    await db_helpers.logActivity(
      'notification_delivery_batch',
      'system',
      0,
      'notification_daemon',
      `Processed ${undeliveredNotifications.length} notifications: ${deliveredCount} delivered, ${errorCount} failed`,
      {
        total_processed: undeliveredNotifications.length,
        delivered: deliveredCount,
        errors: errorCount,
        dry_run,
        agent_filter: agent_filter || null
      },
      workspaceId
    ).catch(() => {});

    return NextResponse.json({
      status: 'success',
      message: `Processed ${undeliveredNotifications.length} notifications`,
      total_processed: undeliveredNotifications.length,
      delivered: deliveredCount,
      errors: errorCount,
      dry_run,
      delivery_results: deliveryResults,
      error_details: errors
    });
  } catch (error) {
    logger.error({ err: error }, 'POST /api/notifications/deliver error');
    return NextResponse.json({ error: 'Failed to deliver notifications' }, { status: 500 });
  }
}

/**
 * GET /api/notifications/deliver - Get delivery status and statistics
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { searchParams } = new URL(request.url);
    const workspaceId = auth.user.workspace_id ?? 1;
    const agent = searchParams.get('agent');

    // Get delivery statistics
    let baseQuery = 'SELECT COUNT(*) as count FROM notifications WHERE workspace_id = ?';
    const params: any[] = [workspaceId];

    if (agent) {
      baseQuery += ' AND recipient = ?';
      params.push(agent);
    }

    const [totalNotifications, undeliveredCount, deliveredCount] = await Promise.all([
      dbGetOne<{ count: number }>(baseQuery, params),
      dbGetOne<{ count: number }>(baseQuery + ' AND delivered_at IS NULL', params),
      dbGetOne<{ count: number }>(baseQuery + ' AND delivered_at IS NOT NULL', params),
    ]);

    // Get recent delivery activity
    const recentDeliveries = await dbGetAll(`
      SELECT
        recipient,
        type,
        title,
        delivered_at,
        created_at
      FROM notifications
      WHERE delivered_at IS NOT NULL AND workspace_id = ?
      ${agent ? 'AND recipient = ?' : ''}
      ORDER BY delivered_at DESC
      LIMIT 10
    `, agent ? [workspaceId, agent] : [workspaceId]);

    // Get agents with pending notifications
    const agentsPending = await dbGetAll<any>(`
      SELECT
        n.recipient,
        a.session_key,
        COUNT(*) as pending_count
      FROM notifications n
      LEFT JOIN agents a ON n.recipient = a.name AND a.workspace_id = n.workspace_id
      WHERE n.delivered_at IS NULL AND n.workspace_id = ?
      GROUP BY n.recipient, a.session_key
      ORDER BY pending_count DESC
    `, [workspaceId]);

    const total = totalNotifications?.count ?? 0;
    const delivered = deliveredCount?.count ?? 0;

    return NextResponse.json({
      statistics: {
        total,
        delivered,
        undelivered: undeliveredCount?.count ?? 0,
        delivery_rate: total > 0 ? Math.round((delivered / total) * 100) : 0
      },
      agents_with_pending: agentsPending,
      recent_deliveries: recentDeliveries,
      agent_filter: agent
    });
  } catch (error) {
    logger.error({ err: error }, 'GET /api/notifications/deliver error');
    return NextResponse.json({ error: 'Failed to get delivery status' }, { status: 500 });
  }
}

/**
 * Format notification for delivery to agent session
 */
function formatNotificationMessage(notification: Notification): string {
  const timestamp = new Date(notification.created_at * 1000).toLocaleString();

  let message = `🔔 **${notification.title}**\n\n`;
  message += `${notification.message}\n\n`;

  if (notification.type === 'mention') {
    message += `📝 You were mentioned in a comment\n`;
  } else if (notification.type === 'assignment') {
    message += `📋 You have been assigned a new task\n`;
  } else if (notification.type === 'due_date') {
    message += `⏰ Task deadline approaching\n`;
  }

  if (notification.source_type && notification.source_id) {
    message += `🔗 Related ${notification.source_type} ID: ${notification.source_id}\n`;
  }

  message += `⏰ ${timestamp}`;

  return message;
}
