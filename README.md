# Paycal

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/yuantao313/paycal)
[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/yuantao313/paycal)

独立的发薪日与月末周六 ICS 订阅服务，可部署到 Cloudflare Workers 或 Vercel。

## 功能

- 公司发薪日订阅：自定义每月几号发薪
- 支持遇休息日提前、延后或不调整
- 月末周六加班订阅：最后一个周六，跳过法定节假日、调休工作日和连续工作 7 天及以上的情况
- 合并订阅：发薪日 + 月末周六
- 实时生成 ICS，无需 GitHub Release

## 订阅地址

```text
/payday.ics?day=15&advance=1&years=2026,2027
/month-end-saturday.ics?years=2026,2027
/combined.ics?day=15&advance=1&years=2026,2027
```

参数：

- `day`：每月发薪日，`1` 到 `31`
- `advance`：`1` 表示遇休息日提前，`0` 表示不调整
- `strategy`：可选，`advance`、`delay`、`none`，优先级高于 `advance`
- `years`：逗号分隔年份；不传默认当年和明年
- `maxStreak`：月末周六连续工作天数阈值，默认 `7`
- `name` / `paydayName` / `saturdayName`：可选日历名称

## 本地测试

```bash
npm test
```

## Cloudflare Workers

本地预览：

```bash
npm run dev:cloudflare
```

部署：

```bash
npm run deploy:cloudflare
```

首次部署前登录：

```bash
npx wrangler@latest login
```

## Vercel

本地预览：

```bash
npm run dev:vercel
```

部署：

```bash
npm run deploy:vercel
```

## GitHub Actions

如果要从 GitHub Actions 部署 Cloudflare Workers，需要设置：

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
