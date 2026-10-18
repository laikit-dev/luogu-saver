// Legal page content, ported from the predecessor project laikit-dev/luogu-saver
// (views/legal/*.njk). Content is authoritative Simplified Chinese legal text and
// should be edited with care. Structure is data-driven so all three pages share a
// single renderer (LegalView.vue).

export type LegalSegment = { kind: 'paragraph'; html: string } | { kind: 'list'; items: string[] };

export interface LegalSection {
    heading: string;
    segments: LegalSegment[];
}

export interface LegalDocument {
    // icon name resolved by the view against a fixed allow-list
    icon: 'privacy' | 'disclaimer' | 'deletion';
    title: string;
    updatedAt: string;
    sections: LegalSection[];
}

export type LegalKey = 'privacy' | 'disclaimer' | 'deletion';

export const LEGAL_DOCUMENTS: Record<LegalKey, LegalDocument> = {
    privacy: {
        icon: 'privacy',
        title: '隐私协议',
        updatedAt: '2026 年 10 月 2 日',
        sections: [
            {
                heading: '一、信息收集',
                segments: [
                    {
                        kind: 'list',
                        items: [
                            '本网站存储并展示来自 <strong>洛谷平台公开的剪贴板和专栏内容</strong>。',
                            '本站会在完整资料保存时记录洛谷公开用户资料的快照；资料快照默认公开，供所有访问者切换历史版本。',
                            '登录后创建的关注关系、稍后阅读清单和摘要偏好保存在本站，并仅向对应登录账号展示，不提供公开关系列表。',
                            '通过第三方网站 CP OAuth 的接口确认身份，并<strong>仅为本站生成登录凭据</strong>，该凭据仅在本站内部使用，不会影响或替代用户的洛谷账号凭据。',
                            '本网站服务器日志可能记录包括 <strong>IP 地址、访问时间、浏览器信息</strong> 在内的常规访问记录,用于安全与审计目的。',
                            '除提供服务所必需的数据外，我们不主动收集额外个人信息。'
                        ]
                    }
                ]
            },
            {
                heading: '二、信息使用',
                segments: [
                    {
                        kind: 'list',
                        items: [
                            '用于身份验证、提供存储与展示功能、站点安全审计与服务改进。',
                            '日志信息（如 IP 地址）主要用于防止滥用、保障安全和排查故障。',
                            '不会将数据用于与本服务无关的用途。'
                        ]
                    }
                ]
            },
            {
                heading: '三、信息公开与共享',
                segments: [
                    {
                        kind: 'list',
                        items: [
                            '自洛谷获取的内容为 <strong>公开信息</strong>，因此会在本站被存储与展示。',
                            '公开资料快照可能保留后来在原站改动或移除的昵称、签名、介绍、等级和奖项列表；本站只记录已采集的版本，不能还原此前未保存的资料。',
                            'RSS 仅提供公开归档条目的标题、本站记录时间和链接，不包含完整文章正文、完整资料内容或私人清单。',
                            '不向第三方出售或出租个人信息；在法律法规或行政 / 司法机关合法要求时，可能提供必要信息。'
                        ]
                    }
                ]
            },
            {
                heading: '四、Cookie 与本地存储',
                segments: [
                    {
                        kind: 'list',
                        items: [
                            '本站可能使用 Cookie 或本地存储保存登录 Token 或会话信息，以维持登录状态与安全风控。',
                            '您可以在浏览器中清除这些数据，但可能导致需要重新登录。'
                        ]
                    }
                ]
            },
            {
                heading: '五、信息安全',
                segments: [
                    {
                        kind: 'list',
                        items: [
                            '我们采取合理的安全措施（如 HTTPS、最小化权限）保护数据安全。',
                            '受限于网络传输与技术环境，无法保证绝对安全。'
                        ]
                    }
                ]
            },
            {
                heading: '六、数据保留与删除',
                segments: [
                    {
                        kind: 'list',
                        items: [
                            '公开内容的存档为提供服务之目的而保留；当源站（洛谷）删除或变更内容时，本站不保证同步时效。',
                            '您可就与您相关的存档提出删除或更正请求，我们将在核实后处理。',
                            '已登录且绑定对应洛谷 UID 的用户可暂停资料快照记录；暂停不会隐藏已保留的公开快照。清空资料历史会删除已保留的快照并停止记录，但不会删除当前资料。恢复记录后，从下一次完整资料保存开始记录新版本。',
                            '私人关注和稍后阅读条目可自行移除。归档摘要默认关闭，可在私人归档清单中开启或关闭。',
                            '删除或清空后，本站的新请求不再返回相应历史；浏览器、RSS 阅读器等已下载的副本无法由本站直接撤回。'
                        ]
                    }
                ]
            },
            {
                heading: '七、跨境传输',
                segments: [
                    {
                        kind: 'paragraph',
                        html: '根据服务部署情况，数据可能在不同地区的服务器间传输与存储，并适用相应法律法规。'
                    }
                ]
            },
            {
                heading: '八、协议更新',
                segments: [
                    {
                        kind: 'paragraph',
                        html: '我们可能适时更新本隐私协议，并在本页公示，更新后自发布之日起生效。'
                    }
                ]
            }
        ]
    },
    disclaimer: {
        icon: 'disclaimer',
        title: '免责声明',
        updatedAt: '2026 年 7 月 7 日',
        sections: [
            {
                heading: '一、内容来源说明',
                segments: [
                    {
                        kind: 'paragraph',
                        html: '本网站存储和展示的剪贴板、专栏等内容均来源于 <strong>洛谷平台公开信息</strong>，仅用于归档与索引,不代表本网站观点或立场。'
                    }
                ]
            },
            {
                heading: '二、内容的真实性与合法性',
                segments: [
                    {
                        kind: 'paragraph',
                        html: '本网站不对所存储内容的真实性、完整性、合法性或时效性作出保证。用户应自行判断并承担使用相关内容的风险。'
                    }
                ]
            },
            {
                heading: '三、知识产权',
                segments: [
                    {
                        kind: 'list',
                        items: [
                            '内容版权归原作者或权利人所有。',
                            '如您认为本网站存档内容侵犯了您的合法权益，请通过本网站联系方式提交权利通知；我们将在核实后采取删除、屏蔽或断开链接等合理措施。'
                        ]
                    }
                ]
            },
            {
                heading: '四、服务可用性',
                segments: [
                    {
                        kind: 'list',
                        items: [
                            '我们致力于提供稳定服务，但不保证服务不中断或无错误，也不对因维护、升级、网络故障、黑客攻击、不可抗力等造成的中断或数据损失承担责任。',
                            '对源站（洛谷）内容的变更、删除或错误导致的检索异常或失效，本站不承担责任。'
                        ]
                    }
                ]
            },
            {
                heading: '五、用户责任',
                segments: [
                    {
                        kind: 'list',
                        items: [
                            '用户在使用本网站服务时应遵守适用的法律法规与平台规则，不得利用本网站实施违法、侵权或不当行为。'
                        ]
                    }
                ]
            },
            {
                heading: '六、责任限制',
                segments: [
                    {
                        kind: 'paragraph',
                        html: '在法律允许范围内，因使用或无法使用本网站服务而造成的任何直接、间接、附带或衍生损失，本网站及其运营者不承担赔偿责任。'
                    }
                ]
            },
            {
                heading: '七、条款更新',
                segments: [
                    {
                        kind: 'paragraph',
                        html: '我们可能适时更新本免责声明，并在本页公示，更新后自发布之日起生效。'
                    }
                ]
            }
        ]
    },
    deletion: {
        icon: 'deletion',
        title: '数据移除政策',
        updatedAt: '2026 年 10 月 2 日',
        sections: [
            {
                heading: '一、移除请求的范围',
                segments: [
                    {
                        kind: 'paragraph',
                        html: '文章和剪贴板可通过站内删除申请入口或联系方式提出移除请求，核实后按本站流程处理。若无特殊情况，申请后删除的形式为<strong>软删除</strong>。已登录且绑定对应洛谷 UID 的用户还可在「资料与快照」中暂停记录或清空自己的资料历史：暂停保留已有公开快照，清空会删除已保留快照并停止后续记录，当前资料不受影响。'
                    }
                ]
            },
            {
                heading: '二、硬删除申请',
                segments: [
                    {
                        kind: 'paragraph',
                        html: '在以下情形下，用户可提出<strong>硬删除</strong>的申请：'
                    },
                    {
                        kind: 'list',
                        items: [
                            '内容涉嫌侵犯第三方合法权益，包括但不限于隐私权、名誉权及著作权；',
                            '内容涉及违法、违规信息，或违反公序良俗；',
                            '其他经本网站合理认定确有必要永久删除的情形。'
                        ]
                    }
                ]
            },
            {
                heading: '三、主动移除',
                segments: [
                    {
                        kind: 'paragraph',
                        html: '本网站有权在无需用户事先同意的情况下，直接删除或屏蔽以下内容：'
                    },
                    {
                        kind: 'list',
                        items: [
                            '违反法律法规、政策规定或司法、行政机关要求的；',
                            '含有恶意攻击、垃圾信息、低俗或其他不当内容的；',
                            '经举报并确认存在侵权、违法或损害第三方权益的；',
                            '本网站认为确有必要采取删除措施的其他情形。'
                        ]
                    }
                ]
            },
            {
                heading: '四、数据残留说明',
                segments: [
                    {
                        kind: 'list',
                        items: [
                            '<strong>软删除</strong>：本网站可能对部分内容实施标记性删除，即该内容不再对外公开展示，且无法被保存，但在数据库中仍可能被保留，以满足审计、安全与合规的合理需求。',
                            '<strong>硬删除</strong>：相关数据将在数据库层面予以彻底移除。但受限于技术条件，相关数据在缓存、日志及系统备份中可能会在一定期限内继续存在，直至完成自动覆盖或清理。本网站将在合理范围内采取措施，最大限度减少残留。',
                            '<strong>外部副本</strong>：本站无法直接撤回访问者、浏览器或 RSS 阅读器已经下载的副本；新的公开时间线、版本和 RSS 请求会重新检查当前可见性。'
                        ]
                    }
                ]
            },
            {
                heading: '五、协议更新',
                segments: [
                    {
                        kind: 'paragraph',
                        html: '我们可能适时更新本政策，并在本页公示，更新后自发布之日起生效。'
                    }
                ]
            }
        ]
    }
};
