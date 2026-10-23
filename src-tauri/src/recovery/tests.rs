use super::*;
#[tokio::test(start_paused = true)]
async fn backoff_is_bounded_and_auth_never_retries() {
    let stop = CancellationToken::new();
    let mut attempts = Vec::new();
    let mut delays = Vec::new();
    let result = supervise(
        &stop,
        |generation| {
            attempts.push(generation);
            async { Err("实时 ASR 连接失败。".into()) }
        },
        |_, delay, _| {
            delays.push(delay.as_secs());
            Ok(())
        },
    )
    .await;
    assert!(result.unwrap_err().contains("自动恢复未成功"));
    assert_eq!(attempts, vec![0, 1, 2, 3, 4, 5, 6]);
    assert_eq!(delays, DELAYS);
    let result = supervise(
        &stop,
        |_| async {
            Err("ASR 认证失败或无模型权限，请检查密钥与账号。（HTTP 401）".into())
        },
        |_, _, _| panic!("auth must not retry"),
    )
    .await;
    assert!(result.unwrap_err().contains("认证失败"));
    for error in ["实时 ASR 任务失败，请检查服务额度、模型权限或音频格式。", "ASR 服务余额不足。（HTTP 402）", "创建目标进程采集失败（系统状态 1）。请检查系统设置中的屏幕与系统音频录制权限，授权后重启应用。", "ASR 地址无效。"] { assert!(!transient(error)); }
}
#[tokio::test(start_paused = true)]
async fn cancel_during_backoff_never_starts_another_attempt() {
    let stop = CancellationToken::new();
    let mut calls = 0;
    supervise(
        &stop,
        |_| {
            calls += 1;
            async { Err("实时 ASR 连接失败。".into()) }
        },
        |_, _, _| {
            stop.cancel();
            Ok(())
        },
    )
    .await
    .unwrap();
    assert_eq!(calls, 1);
}
#[tokio::test(start_paused = true)]
async fn healthy_connection_replenishes_budget_without_reusing_generation() {
    let stop = CancellationToken::new();
    let mut count = 0;
    supervise(
        &stop,
        |generation| {
            assert_eq!(generation, count);
            count += 1;
            async move {
                if generation == 5 {
                    tokio::time::sleep(Duration::from_secs(60)).await;
                }
                if generation == 8 {
                    Ok(())
                } else {
                    Err("实时 ASR 连接失败。".into())
                }
            }
        },
        |_, _, _| Ok(()),
    )
    .await
    .unwrap();
    assert_eq!(count, 9);
}
